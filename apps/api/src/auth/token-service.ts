import { SignJWT } from "jose";
import { createHash, randomBytes } from "crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { JwtClaims } from "@bi/contracts";

export const REFRESH_COOKIE_NAME = "refresh_token";

const ACCESS_TOKEN_TTL = "15m";
/** 7 days in milliseconds */
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecretKey(): Uint8Array {
  const s = process.env["JWT_SECRET"];
  if (!s) throw new Error("JWT_SECRET env var is required");
  return new TextEncoder().encode(s);
}

/** Sign a short-lived HS256 access token carrying {sub, tenantId, roleId, exp}. */
export async function signAccessToken(
  claims: Omit<JwtClaims, "exp">
): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId, roleId: claims.roleId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecretKey());
}

/** SHA-256 hex digest of a raw refresh token — stored in DB, never the raw value. */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generate a cryptographically random URL-safe refresh token. */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Persist a new refresh token record and return the raw token + expiry.
 * The raw value is returned once and never stored in the DB.
 */
export async function createRefreshToken(
  userId: string,
  db: DbClient
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = generateRawToken();
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await (db as PrismaClient).refreshToken.create({
    data: {
      id: crypto.randomUUID(),
      tokenHash,
      userId,
      expiresAt,
    },
  });

  return { raw, expiresAt };
}

/**
 * Look up a valid (non-revoked, non-expired) refresh token record by raw value.
 * Returns null if not found, revoked, or expired.
 */
export async function findValidRefreshToken(
  raw: string,
  db: DbClient
) {
  const tokenHash = hashRefreshToken(raw);
  const record = await (db as PrismaClient).refreshToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.revokedAt !== null || record.expiresAt < new Date()) {
    return null;
  }
  return record;
}

/**
 * Revoke a refresh token by raw value.
 * Returns the userId of the revoked token, or null if not found/already revoked.
 */
export async function revokeRefreshToken(
  raw: string,
  db: DbClient
): Promise<string | null> {
  const tokenHash = hashRefreshToken(raw);
  const record = await (db as PrismaClient).refreshToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.revokedAt !== null || record.expiresAt < new Date()) {
    return null;
  }
  await (db as PrismaClient).refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
  return record.userId;
}
