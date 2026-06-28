import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../db/client.js";
import { withTenant } from "../db/with-tenant.js";
import { logger } from "../observability/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default retention window in days (GAP-4). Override via HISTORY_RETENTION_DAYS. */
export const DEFAULT_RETENTION_DAYS = 365;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantPurgeSummary {
  tenantId: string;
  /** Number of conversations (and their messages) deleted in this run. */
  deletedConversations: number;
}

export interface PurgeResult {
  summaries: TenantPurgeSummary[];
  tenantsProcessed: number;
  tenantsErrored: number;
}

interface CountRow {
  deleted_count: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Hard-delete conversations (and their messages via ON DELETE CASCADE) whose
 * `created_at` is older than `olderThanDays` days, across every active tenant.
 *
 * Each tenant is processed inside its own `search_path` transaction (`SET LOCAL`
 * pattern) so no cross-tenant rows are ever touched.  A structured audit-summary
 * log entry is emitted per tenant with counts only — no row data or PII.
 *
 * Safe to call concurrently or repeatedly; deleting already-absent rows is a
 * no-op (idempotent).
 *
 * @param olderThanDays  Retention window. Defaults to DEFAULT_RETENTION_DAYS (365).
 * @param db             Optional PrismaClient override (for testing).
 */
export async function purgeExpiredConversations(
  { olderThanDays = DEFAULT_RETENTION_DAYS }: { olderThanDays?: number } = {},
  db?: PrismaClient,
): Promise<PurgeResult> {
  const client = db ?? getPrisma();

  const tenants = await client.tenant.findMany({ select: { id: true } });

  const summaries: TenantPurgeSummary[] = [];
  let tenantsErrored = 0;

  for (const { id: tenantId } of tenants) {
    try {
      const summary = await withTenant(
        tenantId,
        async (tx) => {
          // Delete expired conversations; messages cascade via FK.
          // CTE returns count atomically so we know exactly how many were removed.
          const rows = await tx.$queryRawUnsafe<CountRow[]>(
            `WITH deleted AS (
               DELETE FROM conversations
               WHERE created_at < NOW() - (INTERVAL '1 day' * $1::int)
               RETURNING id
             )
             SELECT COUNT(*)::int AS deleted_count FROM deleted`,
            olderThanDays,
          );
          return {
            tenantId,
            deletedConversations: rows[0]?.deleted_count ?? 0,
          };
        },
        client,
      );

      summaries.push(summary);

      // Structured audit summary — counts only, no row data or PII.
      logger.info(
        {
          event: "retention_purge_summary",
          tenantId,
          deletedConversations: summary.deletedConversations,
          olderThanDays,
        },
        "Retention purge completed for tenant",
      );
    } catch (err) {
      tenantsErrored++;
      logger.error(
        { event: "retention_purge_error", tenantId, err },
        "Retention purge failed for tenant",
      );
    }
  }

  return {
    summaries,
    tenantsProcessed: tenants.length,
    tenantsErrored,
  };
}
