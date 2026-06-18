import { jwtVerify, type JWTVerifyOptions } from "jose";
import type { RequestHandler } from "express";
import { JwtClaimsSchema, type ApiErrorResponse } from "@bi/contracts";

export interface AuthContext {
  userId: string;
  tenantId: string;
  roleId: string | null;
}

// Augment Express Request to carry auth context for the duration of a request.
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Encode JWT_SECRET env var as a byte key for jose's symmetric verify. */
function getSecretKey(): Uint8Array {
  const s = process.env["JWT_SECRET"];
  if (!s) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(s);
}

// Restrict to HS256 only — prevents alg-confusion / "none" attacks.
const VERIFY_OPTIONS: JWTVerifyOptions = { algorithms: ["HS256"] };

/**
 * Auth middleware — validates the Bearer JWT and attaches
 * { userId, tenantId, roleId } to req.auth.
 *
 * Returns 401 { code: "AUTH" } on any failure (missing header,
 * expired token, bad signature, wrong algorithm, malformed claims).
 * Never leaks internal error details to the caller.
 */
export const authMiddleware: RequestHandler = async (req, res, next) => {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) {
    const body: ApiErrorResponse = {
      code: "AUTH",
      message: "Missing or malformed Authorization header",
    };
    res.status(401).json(body);
    return;
  }

  try {
    const token = header.slice(7);
    const { payload } = await jwtVerify(token, getSecretKey(), VERIFY_OPTIONS);
    const claims = JwtClaimsSchema.parse(payload);
    req.auth = {
      userId: claims.sub,
      tenantId: claims.tenantId,
      roleId: claims.roleId,
    };
    next();
  } catch {
    // Covers: JWTExpired, JWSSignatureVerificationFailed, JWTClaimValidationFailed,
    // ZodError (malformed claims), and any other unexpected failure.
    const body: ApiErrorResponse = {
      code: "AUTH",
      message: "Invalid or expired token",
    };
    res.status(401).json(body);
  }
};
