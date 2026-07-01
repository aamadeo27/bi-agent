/**
 * GET /api/admin/audit — paginated audit log with filtering.
 * Admin-gated at mount point (requireAdminCapability applied in index.ts).
 */

import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { z } from "zod";
import { AuditEventTypeSchema } from "@bi/contracts";
import type { ApiErrorResponse } from "@bi/contracts";
import { logger } from "../observability/logger.js";

export const auditRouter: ExpressRouter = Router();

const AuditQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  type: AuditEventTypeSchema.optional(),
  userId: z.string().optional(),
  dataSourceId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

interface AuditRow {
  id: string;
  tenant_id: string;
  at: Date;
  actor_user_id: string;
  role_name_at_event: string;
  type: string;
  outcome: string;
  data_source_id: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
}

auditRouter.get("/", async (req: Request, res: Response) => {
  const parsed = AuditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
    res.status(400).json(body);
    return;
  }

  const { from, to, type, userId, dataSourceId, page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;

  if (!req.withTenantTx) {
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Tenant context unavailable" };
    res.status(500).json(body);
    return;
  }

  try {
    const rows = await req.withTenantTx<AuditRow[]>((tx) =>
      tx.$queryRawUnsafe<AuditRow[]>(
        `SELECT id, tenant_id, at, actor_user_id, role_name_at_event,
                type, outcome, data_source_id, detail, ip
         FROM audit_events
         WHERE ($1::timestamptz IS NULL OR at >= $1::timestamptz)
           AND ($2::timestamptz IS NULL OR at <= $2::timestamptz)
           AND ($3::text IS NULL OR type = $3)
           AND ($4::text IS NULL OR actor_user_id = $4)
           AND ($5::text IS NULL OR data_source_id = $5)
         ORDER BY at DESC
         LIMIT $6 OFFSET $7`,
        from ?? null,
        to ?? null,
        type ?? null,
        userId ?? null,
        dataSourceId ?? null,
        pageSize,
        offset,
      ),
    );

    const events = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      actorUserId: r.actor_user_id,
      roleNameAtEvent: r.role_name_at_event,
      type: r.type,
      outcome: r.outcome,
      ...(r.data_source_id !== null ? { dataSourceId: r.data_source_id } : {}),
      detail: r.detail,
      ...(r.ip !== null ? { ip: r.ip } : {}),
    }));

    res.json({ events, page, pageSize });
  } catch (err) {
    logger.error(err, "audit GET / error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to list audit events" };
    res.status(500).json(body);
  }
});
