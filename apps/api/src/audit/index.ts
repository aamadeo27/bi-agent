/**
 * Audit log writer — persists AuditEvent on every query/admin action (GAP-9 confirmed).
 * See: docs/kb/contracts/audit-event.md
 */

import type { AuditEvent } from "@bi/contracts";
import { withTenant } from "../db/with-tenant.js";
import { logger } from "../observability/logger.js";

/**
 * Persist an audit event to the tenant's audit_events table.
 * Never throws — logs on failure so pipeline doesn't abort on an audit error.
 */
export async function emitAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_events
           (id, tenant_id, at, actor_user_id, role_name_at_event, type, outcome, data_source_id, detail, ip)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
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
    logger.error({ err, eventId: event.id }, "emitAuditEvent: failed to persist audit event");
  }
}
