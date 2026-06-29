import { Router } from "express";
import type { Request, Response, IRouter } from "express";
import { z } from "zod";
import type { ApiErrorResponse, GeneratedQueryView } from "@bi/contracts";
import { logger } from "../observability/logger.js";

const MessageIdSchema = z.object({
  id: z.string().min(1).max(128),
});

interface CapabilityRow {
  capabilities: { canInspectQuery: boolean };
}

interface QueryMessageRow {
  id: string;
  query_type: string;
  generated_query: string;
  row_count: number | null;
  data_source_name: string | null;
  created_at: Date;
}

/** Discriminated result from the withTenantTx callback — avoids null/undefined sentinels. */
type QueryResult =
  | { kind: "ok"; view: GeneratedQueryView }
  | { kind: "denied" }
  | { kind: "not_found" };

export const messagesRouter: IRouter = Router();

// ── GET /api/messages/:id/query ───────────────────────────────────────────────
//
// Returns GeneratedQueryView for the given assistant message.
// Gated by capabilities.canInspectQuery on the requester's role (GAP-1 locked).
// Tenant-scoped via search_path (withTenantTx) + conversation ownership JOIN.

messagesRouter.get("/:id/query", async (req: Request, res: Response) => {
  // ── 1. Validate param ───────────────────────────────────────────────────────
  const parsed = MessageIdSchema.safeParse(req.params);
  if (!parsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Invalid message id" };
    res.status(400).json(body);
    return;
  }
  const { id: messageId } = parsed.data;

  // ── 2. Guard: auth middleware must have run ─────────────────────────────────
  const auth = req.auth;
  if (!auth) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Not authenticated" };
    res.status(401).json(body);
    return;
  }

  // ── 3. Require a role ───────────────────────────────────────────────────────
  if (!auth.roleId) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Role required to inspect queries" };
    res.status(403).json(body);
    return;
  }

  try {
    const result: QueryResult = await req.withTenantTx!(async (tx) => {
      // ── 4. Check canInspectQuery capability ─────────────────────────────────
      const capRows = await tx.$queryRawUnsafe<CapabilityRow[]>(
        `SELECT capabilities FROM roles WHERE id = $1`,
        auth.roleId,
      );

      if (!capRows.length || !capRows[0].capabilities?.canInspectQuery) {
        return { kind: "denied" };
      }

      // ── 5. Fetch message scoped to the current user's conversations ─────────
      // INNER JOIN conversations enforces conversation ownership (c.user_id = $2).
      // LEFT JOIN data_sources handles gracefully when a source has been deleted.
      // Tenant isolation is structural: withTenantTx pins search_path via SET LOCAL,
      // so these tables are always resolved within the caller's tenant schema.
      const rows = await tx.$queryRawUnsafe<QueryMessageRow[]>(
        `SELECT
           m.id,
           m.query_type,
           m.generated_query,
           (m.result_envelope->>'rowCount')::int AS row_count,
           m.created_at,
           ds.name AS data_source_name
         FROM messages m
         INNER JOIN conversations c ON c.id = m.conversation_id AND c.user_id = $2
         LEFT JOIN data_sources ds ON ds.id = m.data_source_id
         WHERE m.id = $1
           AND m.generated_query IS NOT NULL
           AND m.query_type IS NOT NULL`,
        messageId,
        auth.userId,
      );

      if (!rows.length) {
        return { kind: "not_found" };
      }

      const row = rows[0];

      return {
        kind: "ok",
        view: {
          messageId: row.id,
          queryType: row.query_type as "sql" | "rest",
          queryText: row.generated_query,
          dataSourceName: row.data_source_name ?? "",
          // executedAt: mapped to message.created_at — the timestamp of pipeline
          // completion, which is the closest stored proxy for query execution time
          // (query is executed and message is persisted in the same pipeline step).
          // Awaiting Architect confirmation that this mapping is the intended semantic.
          executedAt: row.created_at.toISOString(),
          rowCount: row.row_count ?? 0,
        },
      };
    });

    if (result.kind === "denied") {
      const body: ApiErrorResponse = { code: "AUTH", message: "canInspectQuery capability required" };
      res.status(403).json(body);
      return;
    }

    if (result.kind === "not_found") {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Message not found or has no generated query" };
      res.status(404).json(body);
      return;
    }

    res.json(result.view);
  } catch (err) {
    logger.error({ err }, "messages GET /:id/query error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch query" };
    res.status(500).json(body);
  }
});
