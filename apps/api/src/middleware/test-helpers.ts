/**
 * Shared test helpers for auth middleware tests.
 * Import from auth.test.ts and auth.security.test.ts only.
 */
import express from "express";
import { SignJWT } from "jose";
import type { Application } from "express";
import { authMiddleware } from "./auth.js";

export const TEST_SECRET = "test-secret-at-least-32-bytes!!";
export const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);

/**
 * Sign an HS256 JWT with the given claims.
 * @param claims   JWT payload fields (must include `sub`)
 * @param key      Signing key — defaults to SECRET_KEY (the test secret)
 * @param expiresIn  jose duration string, e.g. "15m", "-1m" for expired
 */
export async function signToken(
  claims: Record<string, unknown>,
  key: Uint8Array = SECRET_KEY,
  expiresIn = "15m"
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims["sub"]))
    .setExpirationTime(expiresIn)
    .sign(key);
}

/**
 * Minimal Express app with authMiddleware on GET /protected.
 * The handler returns req.auth (or null) as JSON.
 */
export function buildAuthApp(): Application {
  const app = express();
  app.use(express.json());
  app.get("/protected", authMiddleware, (req, res) => {
    res.json(req.auth ?? null);
  });
  return app;
}
