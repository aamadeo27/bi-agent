import { verify as argon2Verify } from "@node-rs/argon2";
import type { PrismaClient } from "@prisma/client";
import {
  signAccessToken,
  createRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
} from "./token-service.js";

export interface AuthTokens {
  accessToken: string;
  refreshRaw: string;
  refreshExpiresAt: Date;
  /** Included for audit emission at the call site — never sent to client. */
  userId: string;
  tenantId: string;
  roleId: string | null;
}

/** Attached to AUTH errors thrown by login() so the caller can emit login_failed audit. */
export interface AuthFailContext {
  auditContext: { userId: string; tenantId: string; roleId: string | null } | null;
}

/**
 * Verify email+password against the stored argon2id hash and issue tokens.
 * Throws { code: "AUTH" } for any credential failure (constant-time on miss).
 */
export async function login(
  email: string,
  password: string,
  db: PrismaClient
): Promise<AuthTokens> {
  const user = await db.user.findUnique({ where: { email } });

  // Always run verify to prevent timing-based user enumeration.
  // The dummy hash below is a valid argon2id hash of "dummy" so verify() never throws.
  const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH;

  let valid = false;
  try {
    valid = await argon2Verify(hashToCheck, password);
  } catch {
    valid = false;
  }

  if (!user || !valid) {
    throw Object.assign(new Error("Invalid credentials"), {
      code: "AUTH",
      auditContext: user
        ? { userId: user.id, tenantId: user.tenantId ?? "", roleId: user.roleId ?? null }
        : null,
    });
  }

  if (user.status !== "active") {
    throw Object.assign(new Error("Account is not active"), {
      code: "AUTH",
      auditContext: { userId: user.id, tenantId: user.tenantId ?? "", roleId: user.roleId ?? null },
    });
  }

  const accessToken = await signAccessToken({
    sub: user.id,
    tenantId: user.tenantId ?? "",
    roleId: user.roleId ?? null,
  });

  const { raw: refreshRaw, expiresAt: refreshExpiresAt } =
    await createRefreshToken(user.id, db);

  return {
    accessToken,
    refreshRaw,
    refreshExpiresAt,
    userId: user.id,
    tenantId: user.tenantId ?? "",
    roleId: user.roleId ?? null,
  };
}

/**
 * Rotate refresh tokens: revoke the presented token, re-read the user's
 * current roleId from DB (GAP-17 propagation), issue new access + refresh tokens.
 * Throws { code: "AUTH" } for an invalid/expired/revoked refresh token.
 */
export async function refresh(
  rawRefreshToken: string,
  db: PrismaClient
): Promise<AuthTokens> {
  const record = await findValidRefreshToken(rawRefreshToken, db);
  if (!record) {
    throw Object.assign(new Error("Invalid or expired refresh token"), {
      code: "AUTH",
    });
  }

  // Re-read current user state so roleId changes propagate (GAP-17).
  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user || user.status !== "active") {
    throw Object.assign(new Error("Account is not active"), { code: "AUTH" });
  }

  // Revoke old token before issuing new one (rotation).
  await revokeRefreshToken(rawRefreshToken, db);

  const accessToken = await signAccessToken({
    sub: user.id,
    tenantId: user.tenantId ?? "",
    roleId: user.roleId ?? null,
  });

  const { raw: refreshRaw, expiresAt: refreshExpiresAt } =
    await createRefreshToken(user.id, db);

  return {
    accessToken,
    refreshRaw,
    refreshExpiresAt,
    userId: user.id,
    tenantId: user.tenantId ?? "",
    roleId: user.roleId ?? null,
  };
}

/**
 * Revoke the refresh token (best-effort — no error if already revoked/missing).
 */
export async function logout(
  rawRefreshToken: string,
  db: PrismaClient
): Promise<void> {
  await revokeRefreshToken(rawRefreshToken, db);
}
