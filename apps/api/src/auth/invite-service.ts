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

  // Platform-level user record (auth identity, no password yet).
  await db.user.create({
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

  // Tenant-schema user row (profile + auth_methods).
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

  // Opaque invite token — raw value emailed, only hash stored.
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

  await db.inviteToken.create({
    data: {
      id: crypto.randomUUID(),
      tokenHash,
      userId,
      tenantId: params.tenantId,
      expiresAt,
    },
  });

  const inviteUrl = `${getAppBaseUrl()}/invite/accept?token=${rawToken}`;
  await mailer.sendInvite({ to: params.email, displayName: params.displayName, inviteUrl });

  return { userId };
}

export interface AcceptInviteParams {
  token: string;
  /** Required for password-based activation. SSO linking is future work. */
  password?: string | undefined;
}

/**
 * Validate invite token → hash password → activate user → issue auth tokens.
 *
 * Throws:
 *  - { code: "AUTH" }       — token invalid / expired / already used
 *  - { code: "VALIDATION" } — password missing
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

  if (!params.password) {
    throw Object.assign(new Error("password is required to accept an invite"), {
      code: "VALIDATION",
    });
  }

  const passwordHash = await argon2Hash(params.password);

  // Mark token used + activate platform user atomically.
  await db.$transaction(async (tx) => {
    await tx.inviteToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, status: "active" },
    });
  });

  // Activate tenant-schema user and record auth method.
  await withTenant(
    record.tenantId,
    async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users
         SET status = 'active', auth_methods = '["password"]'::jsonb, updated_at = NOW()
         WHERE id = $1`,
        record.userId
      );
    },
    db
  );

  const user = await db.user.findUniqueOrThrow({ where: { id: record.userId } });

  const accessToken = await signAccessToken({
    sub: user.id,
    tenantId: user.tenantId ?? "",
    roleId: user.roleId ?? null,
  });

  const { raw: refreshRaw, expiresAt: refreshExpiresAt } = await createRefreshToken(
    user.id,
    db
  );

  return { accessToken, refreshRaw, refreshExpiresAt };
}
