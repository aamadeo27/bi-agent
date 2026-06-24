import type { RequestHandler } from "express";
import type { ApiErrorResponse } from "@bi/contracts";

interface RoleCapabilityRow {
  capabilities: { canInspectQuery: boolean };
}

/**
 * Middleware: requires the caller's role to have canInspectQuery: true.
 * Must run after authMiddleware + tenantScopeMiddleware (req.auth and req.withTenantTx must be set).
 * Returns 403 AUTH when the caller has no role or the role lacks admin capability.
 */
export const requireAdminCapability: RequestHandler = async (req, res, next) => {
  const auth = req.auth!;

  if (!auth.roleId) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Admin role required" };
    res.status(403).json(body);
    return;
  }

  try {
    const rows = await req.withTenantTx!<RoleCapabilityRow[]>((tx) =>
      tx.$queryRawUnsafe<RoleCapabilityRow[]>(
        `SELECT capabilities FROM roles WHERE id = $1`,
        auth.roleId,
      ),
    );

    if (!rows.length) {
      const body: ApiErrorResponse = { code: "AUTH", message: "Admin role required" };
      res.status(403).json(body);
      return;
    }

    const caps = rows[0].capabilities;
    if (!caps?.canInspectQuery) {
      const body: ApiErrorResponse = { code: "AUTH", message: "Admin capability required" };
      res.status(403).json(body);
      return;
    }

    next();
  } catch {
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Authorization check failed" };
    res.status(500).json(body);
  }
};
