/**
 * Audit log writer — persists AuditEvent on every query/admin action (GAP-9 confirmed).
 * See: docs/kb/contracts/audit-event.md
 */

import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@bi/contracts";
import { withTenant } from "../db/with-tenant.js";
import { logger } from "../observability/logger.js";
import type { AuthContext } from "../middleware/auth.js";

const INSERT_SQL = `INSERT INTO audit_events
  (id, tenant_id, at, actor_user_id, role_name_at_event, type, outcome, data_source_id, detail, ip)
VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9::jsonb, $10)`;

/**
 * Persist an audit event to the tenant's audit_events table.
 * Never throws — logs on failure so pipeline doesn't abort on an audit error.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        INSERT_SQL,
        event.id,
        event.tenantId,
        event.at,
        event.actorUserId,
        event.roleNameAtEvent,
        event.type,
        event.outcome,
        event.dataSourceId ?? null,
        JSON.stringify(event.detail),
        event.ip ?? null,
      );
    });
  } catch (err) {
    logger.error({ err, eventId: event.id }, "recordAudit: failed to persist audit event");
  }
}

/** @deprecated use recordAudit */
export const emitAuditEvent = recordAudit;

/**
 * Emit an audit event for an admin-panel action.
 * Resolves the actor's role name from the tenant schema in the same TX as the insert.
 * Never throws.
 */
export async function emitAdminAudit(
  auth: AuthContext,
  ip: string | undefined,
  partial: Omit<AuditEvent, "id" | "tenantId" | "at" | "actorUserId" | "roleNameAtEvent" | "ip">,
): Promise<void> {
  const eventId = randomUUID();
  const at = new Date().toISOString();
  try {
    await withTenant(auth.tenantId, async (tx) => {
      let roleName = "none";
      if (auth.roleId) {
        const rows = await tx.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM roles WHERE id = $1`,
          auth.roleId,
        );
        roleName = rows[0]?.name ?? "unknown";
      }
      await tx.$executeRawUnsafe(
        INSERT_SQL,
        eventId,
        auth.tenantId,
        at,
        auth.userId,
        roleName,
        partial.type,
        partial.outcome,
        partial.dataSourceId ?? null,
        JSON.stringify(partial.detail),
        ip ?? null,
      );
    });
  } catch (err) {
    logger.error({ err, eventId }, "emitAdminAudit: failed to persist audit event");
  }
}
