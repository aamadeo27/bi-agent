import { jwtVerify, type JWTVerifyOptions } from "jose";
import type { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { JwtClaimsSchema, type ApiErrorResponse } from "@bi/contracts";

export interface AuthContext {
  userId: string;
  tenantId: string;
  roleId: string | null;
}

// All Express.Request augmentations live here — single location for the request shape.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by authMiddleware from the validated JWT. */
      auth?: AuthContext;
      /**
       * Runs fn inside a Prisma $transaction with SET LOCAL search_path scoped to
       * this request's tenant. Attached by tenantScopeMiddleware.
       * All control-plane DB access within the request MUST go through this wrapper.
       */
      withTenantTx?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
    }
  }
}

// Memoised once on first use — avoids re-encoding on every request.
// Call initAuth() at process startup to validate JWT_SECRET eagerly.
let _secretKey: Uint8Array | undefined;

function getSecretKey(): Uint8Array {
  _secretKey ??= (() => {
    const s = process.env["JWT_SECRET"];
    if (!s) throw new Error("JWT_SECRET env var is required — set it before starting the server");
    return new TextEncoder().encode(s);
  })();
  return _secretKey;
}

/**
 * Validate JWT_SECRET at process startup.
 * Throws immediately if the env var is absent so the process fails fast
 * rather than returning 401 on every request silently.
 */
export function initAuth(): void {
  getSecretKey();
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
