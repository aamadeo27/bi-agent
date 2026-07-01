import { hash as argon2Hash } from "@node-rs/argon2";
import { createHash, randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { signAccessToken, createRefreshToken } from "./token-service.js";
import type { AuthTokens } from "./auth-service.js";
import { withTenant } from "../db/with-tenant.js";
import type { MailerPort } from "../mailer/port.js";

/** 72 hours — reasonable window for invite links. */
const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function getAppBaseUrl(): string {
  return process.env["APP_BASE_URL"] ?? "http://localhost:5173";
}

export interface CreateInviteParams {
  tenantId: string;
  email: string;
  displayName: string;
  roleId?: string | undefined;
  invitedByUserId: string;
}

/**
 * Create an invited user in platform.users + matching tenant-schema entry,
 * generate a signed expiring invite token, and dispatch an invite email.
 *
 * Atomicity: platform user + invite token are created in a single $transaction.
 * If the subsequent tenant-schema insert fails, the platform records are cleaned
 * up so re-invite is possible.
 *
 * Throws { code: "VALIDATION" } if the email is already registered.
 */
export async function createInvite(
  params: CreateInviteParams,
  db: PrismaClient,
  mailer: MailerPort
): Promise<{ userId: string }> {
  const existing = await db.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw Object.assign(new Error("A user with that email already exists"), {
      code: "VALIDATION",
    });
  }

  const userId = crypto.randomUUID();

  // Pre-generate token material before any DB write so no partial state is left
  // if token generation itself were to fail.
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const tokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

  // Atomically persist platform user + invite token.
  // Either both land or neither does — no orphaned user without a reachable token.
  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email: params.email,
        displayName: params.displayName,
        passwordHash: null,
        status: "invited",
        tenantId: params.tenantId,
        roleId: params.roleId ?? null,
      },
    });
    await tx.inviteToken.create({
      data: {
        id: crypto.randomUUID(),
        tokenHash,
        userId,
        tenantId: params.tenantId,
        expiresAt: tokenExpiresAt,
      },
    });
  });

  // Tenant-schema user row (profile + auth_methods). Runs outside the platform
  // transaction because withTenant opens its own transaction (Prisma does not
  // support nested interactive transactions). On failure we clean up the platform
  // records so re-invite remains possible.
  try {
    await withTenant(
      params.tenantId,
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO users (id, email, display_name, status, role_id, auth_methods, created_at, updated_at)
           VALUES ($1, $2, $3, 'invited', $4, '[]'::jsonb, NOW(), NOW())
           ON CONFLICT (email) DO NOTHING`,
          userId,
          params.email,
          params.displayName,
          params.roleId ?? null
        );
      },
      db
    );
  } catch (tenantErr) {
    // Best-effort cleanup — cascades to invite_token via FK.
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    throw tenantErr;
  }

  const inviteUrl = `${getAppBaseUrl()}/invite/accept?token=${rawToken}`;
  await mailer.sendInvite({ to: params.email, displayName: params.displayName, inviteUrl });

  return { userId };
}

export interface AcceptInviteParams {
  token: string;
  /** Password-based activation — set a new password for the invited account. */
  password?: string | undefined;
  /**
   * SSO-based activation — the verified OIDC `sub` claim from a completed IdP
   * flow (T2.3). Activates the user without a password, sets auth_methods=['sso'].
   * Exactly one of password or ssoSubject must be supplied.
   */
  ssoSubject?: string | undefined;
}

/**
 * Validate invite token → activate user (password or SSO) → issue auth tokens.
 *
 * Ordering rationale:
 *  1. withTenant UPDATE runs first — idempotent; if it fails nothing is committed.
 *  2. $transaction marks token used + updates platform user — returns activated user
 *     directly, eliminating an extra SELECT round-trip.
 *
 * Safe retry: if step 2 fails after step 1 succeeds the tenant row is already
 * 'active' but the token is still unused, so re-submitting succeeds (step 1 is
 * an idempotent UPDATE).
 *
 * Throws:
 *  - { code: "AUTH" }       — token invalid / expired / already used
 *  - { code: "VALIDATION" } — neither password nor ssoSubject provided
 */
export async function acceptInvite(
  params: AcceptInviteParams,
  db: PrismaClient
): Promise<AuthTokens> {
  const tokenHash = hashToken(params.token);
  const record = await db.inviteToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
    throw Object.assign(
      new Error("Invalid, expired, or already-used invite token"),
      { code: "AUTH" }
    );
  }

  const hasPassword = Boolean(params.password);
  const hasSso = Boolean(params.ssoSubject);

  if (!hasPassword && !hasSso) {
    throw Object.assign(
      new Error("Either password or ssoSubject is required to accept an invite"),
      { code: "VALIDATION" }
    );
  }

  // Hash password for password-based activation; SSO path skips this.
  const passwordHash = hasPassword ? await argon2Hash(params.password!) : null;
  const authMethods = hasPassword ? '["password"]' : '["sso"]';

  // Step 1: activate tenant-schema user (idempotent — safe to retry if step 2 fails).
  await withTenant(
    record.tenantId,
    async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users
         SET status = 'active', auth_methods = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        record.userId,
        authMethods
      );
    },
    db
  );

  // Step 2: mark token used + activate platform user atomically.
  // Returns the updated user directly — no extra SELECT round-trip needed.
  const activatedUser = await db.$transaction(async (tx) => {
    await tx.inviteToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: {
        ...(passwordHash !== null ? { passwordHash } : {}),
        status: "active",
      },
    });
  });

  if (!activatedUser.tenantId) {
    throw Object.assign(
      new Error("Activated user has no tenantId — cannot issue token"),
      { code: "INTERNAL" }
    );
  }

  const accessToken = await signAccessToken({
    sub: activatedUser.id,
    tenantId: activatedUser.tenantId,
    roleId: activatedUser.roleId ?? null,
  });

  const { raw: refreshRaw, expiresAt: refreshExpiresAt } = await createRefreshToken(
    activatedUser.id,
    db
  );

  return {
    accessToken,
    refreshRaw,
    refreshExpiresAt,
    userId: activatedUser.id,
    tenantId: activatedUser.tenantId,
    roleId: activatedUser.roleId ?? null,
  };
}
