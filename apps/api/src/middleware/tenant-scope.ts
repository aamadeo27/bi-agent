import type { RequestHandler } from "express";
import type { ApiErrorResponse } from "@bi/contracts";

/**
 * Recursively collect every string value at a key named "tenantId"
 * anywhere in the body object (including nested objects and arrays).
 *
 * Exported for unit-testing the extraction logic in isolation.
 */
export function collectTenantIds(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectTenantIds);

  const ids: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "tenantId" && typeof v === "string") {
      ids.push(v);
    } else {
      ids.push(...collectTenantIds(v));
    }
  }
  return ids;
}

/**
 * Tenant-scope middleware — MUST run after authMiddleware.
 *
 * Defense-in-depth: tenant identity comes ONLY from the validated JWT.
 * Any request body that contains a "tenantId" field (at any depth) with
 * a value that differs from req.auth.tenantId is rejected with 403 TENANT.
 *
 * This prevents a caller from referencing another tenant's data even
 * if a downstream handler mistakenly reads tenantId from the body.
 */
export const tenantScopeMiddleware: RequestHandler = (req, res, next) => {
  if (!req.auth) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Not authenticated" };
    res.status(401).json(body);
    return;
  }

  const { tenantId } = req.auth;
  const foreign = collectTenantIds(req.body).filter((id) => id !== tenantId);

  if (foreign.length > 0) {
    const body: ApiErrorResponse = {
      code: "TENANT",
      message: "Request body references a foreign tenant",
    };
    res.status(403).json(body);
    return;
  }

  next();
};
