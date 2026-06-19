import type { RequestHandler } from "express";
import type { ApiErrorResponse } from "@bi/contracts";
import { withTenant } from "../db/with-tenant.js";
import { validateTenantId } from "../db/tenant-utils.js";

/** Maximum recursion depth for body scanning — prevents stack exhaustion on crafted input. */
const MAX_DEPTH = 20;

/**
 * Recursively collect every string value at a key named "tenantId"
 * anywhere in the body object (including nested objects and arrays).
 * Stops at MAX_DEPTH to prevent stack exhaustion from crafted payloads.
 *
 * Exported for unit-testing the extraction logic in isolation.
 */
export function collectTenantIds(value: unknown, depth = 0): string[] {
  if (depth >= MAX_DEPTH) return [];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => collectTenantIds(v, depth + 1));
  }

  const ids: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "tenantId" && typeof v === "string") {
      ids.push(v);
    } else {
      ids.push(...collectTenantIds(v, depth + 1));
    }
  }
  return ids;
}

/**
 * Tenant-scope middleware — MUST run after authMiddleware.
 *
 * 1. Validates the tenantId from the JWT against the allowed format [a-zA-Z0-9]+.
 * 2. Rejects any body that contains a "tenantId" value differing from the auth
 *    tenant (defense-in-depth; tenant identity comes only from the validated token).
 * 3. Attaches req.withTenantTx — a pre-bound wrapper around withTenant — so all
 *    control-plane DB access in the request automatically runs under
 *    SET LOCAL search_path TO "tenant_<id>", platform inside a Prisma transaction.
 */
export const tenantScopeMiddleware: RequestHandler = (req, res, next) => {
  if (!req.auth) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Not authenticated" };
    res.status(401).json(body);
    return;
  }

  const { tenantId } = req.auth;

  // Whitelist tenantId format before it reaches any DB interpolation.
  // validateTenantId throws on invalid input (see db/tenant-utils.ts).
  try {
    validateTenantId(tenantId);
  } catch {
    const body: ApiErrorResponse = {
      code: "TENANT",
      message: "Invalid tenant identifier in token",
    };
    res.status(403).json(body);
    return;
  }

  // Scan body for any tenantId that differs from the auth tenant.
  const foreign = collectTenantIds(req.body).filter((id) => id !== tenantId);
  if (foreign.length > 0) {
    const body: ApiErrorResponse = {
      code: "TENANT",
      message: "Request body references a foreign tenant",
    };
    res.status(403).json(body);
    return;
  }

  // Attach the tenant-scoped DB wrapper. Handlers call:
  //   const result = await req.withTenantTx!(async (tx) => { /* Prisma tx queries */ });
  // which issues SET LOCAL search_path TO "tenant_<id>", platform before any query.
  req.withTenantTx = (fn) => withTenant(tenantId, fn);

  next();
};
