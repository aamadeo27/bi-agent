import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
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
  result_envelope: { rowCount: number } | null;
  data_source_name: string | null;
  created_at: Date;
}

export const messagesRouter: ExpressRouter = Router();

// ── GET /api/messages/:id/query ───────────────────────────────────────────────
//
// Returns GeneratedQueryView for the given assistant message.
// Gated by capabilities.canInspectQuery on the requester's role (GAP-1 locked).
// Tenant-scoped via search_path (withTenantTx) + conversation ownership check.

messagesRouter.get("/:id/query", async (req: Request, res: Response) => {
  // ── 1. Validate param ───────────────────────────────────────────────────────
  const parsed = MessageIdSchema.safeParse(req.params);
  if (!parsed.success) {
    const body: ApiErrorResponse = { code: "VALIDATION", message: "Invalid message id" };
    res.status(400).json(body);
    return;
  }
  const { id: messageId } = parsed.data;

  const auth = req.auth!;

  // ── 2. Require a role ───────────────────────────────────────────────────────
  if (!auth.roleId) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Role required to inspect queries" };
    res.status(403).json(body);
    return;
  }

  try {
    const view = await req.withTenantTx!(async (tx) => {
      // ── 3. Check canInspectQuery capability ─────────────────────────────────
      const capRows = await tx.$queryRawUnsafe<CapabilityRow[]>(
        `SELECT capabilities FROM roles WHERE id = $1`,
        auth.roleId,
      );

      if (!capRows.length || !capRows[0].capabilities?.canInspectQuery) {
        return null; // signals 403
      }

      // ── 4. Fetch message scoped to the current user's conversations ─────────
      // LEFT JOIN data_sources for the name (handles deleted source gracefully).
      // c.user_id = $2 enforces conversation ownership (tenant-scoped by search_path).
      const rows = await tx.$queryRawUnsafe<QueryMessageRow[]>(
        `SELECT
           m.id,
           m.query_type,
           m.generated_query,
           m.result_envelope,
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
        return undefined; // signals 404
      }

      const row = rows[0];
      const rowCount = row.result_envelope?.rowCount ?? 0;

      const result: GeneratedQueryView = {
        messageId: row.id,
        queryType: row.query_type as "sql" | "rest",
        queryText: row.generated_query,
        dataSourceName: row.data_source_name ?? "",
        executedAt: row.created_at.toISOString(),
        rowCount,
      };
      return result;
    });

    if (view === null) {
      const body: ApiErrorResponse = { code: "AUTH", message: "canInspectQuery capability required" };
      res.status(403).json(body);
      return;
    }

    if (view === undefined) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Message not found or has no generated query" };
      res.status(404).json(body);
      return;
    }

    res.json(view);
  } catch (err) {
    logger.error({ err }, "messages GET /:id/query error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch query" };
    res.status(500).json(body);
  }
});
