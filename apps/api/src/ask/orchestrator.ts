/**
 * T5.5 — Ask Orchestrator.
 *
 * Wires the full Action A pipeline:
 *   resolve identity/tenant/role
 *   → build LLM context (schema metadata only, no row data — GAP-18)
 *   → generateQuery
 *   → permission gate (T5.2)
 *   → validator (T5.3)
 *   → execute via Query Proxy (T4.4)
 *   → chart selection (T5.4)
 *   → stream meta/token/result/block/error/done events
 *   → persist messages + emit audit event
 *
 * The caller (SSE route handler) drives SSE writes via the `send` callback and
 * aborts the pipeline via `signal` (wired to the HTTP close event).
 */

import { randomUUID } from "node:crypto";
import { withTenant } from "../db/with-tenant.js";
import { addMessage, getHistoryWindow } from "../conversations/index.js";
import { evaluateGate, type Dialect } from "./permission-gate.js";
import { validateQuery } from "./query-validator.js";
import type { ValidatedQuery as ValidatorQuery } from "./query-validator.js";
import { selectChartType } from "./select-chart-type.js";
import { execute as proxyExecute } from "../datasource/query-proxy.js";
import type { ValidatedQuery as ProxyQuery } from "../datasource/query-proxy.js";
import { emitAuditEvent } from "../audit/index.js";
import type { LlmProvider } from "../llm/port.js";
import type {
  ResourceGrantSet,
  ResultEnvelope,
  PermissionBlock,
  AuditEventType,
} from "@bi/contracts";
import { logger } from "../observability/logger.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Token budget for windowed conversation history injected into LLM context. */
const HISTORY_TOKEN_BUDGET = 4_000;

// ── Public types ───────────────────────────────────────────────────────────────

/** Callback that writes a single SSE event to the response stream. */
export type SseSender = (event: string, data: unknown) => void;

export interface OrchestratorArgs {
  tenantId: string;
  userId: string;
  /** Non-null role id — caller must reject null before calling. */
  roleId: string;
  conversationId: string;
  /** User's natural-language question. */
  text: string;
  llm: LlmProvider;
  send: SseSender;
  signal: AbortSignal;
  ip?: string;
}

// ── Internal errors ────────────────────────────────────────────────────────────

export class OrchestratorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

/**
 * Throw (or have the LLM adapter throw) this when the model cannot generate
 * a query because it needs clarification from the user.
 *
 * The orchestrator catches this specifically and emits an SSE `error` event
 * with code `CLARIFICATION` so the client can render the clarification UI state.
 */
export class LlmClarificationError extends Error {
  readonly code = "CLARIFICATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmClarificationError";
  }
}

// ── DB row shapes ──────────────────────────────────────────────────────────────

interface GrantRow {
  data_source_id: string;
  kind: "schema" | "table" | "column";
  schema: string;
  table: string | null;
  column: string | null;
}

interface DataSourceRow {
  id: string;
  type: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Map a data-source connector type string to a gate/validator Dialect. */
function typeToDialect(type: string): Dialect {
  if (type === "mysql") return "mysql";
  if (type === "bigquery") return "bigquery";
  return "postgres"; // default covers postgres + REST (gate handles REST separately)
}

/**
 * Builds a schema description for the LLM context from the role's grants.
 * Contains ONLY schema metadata (names), never row values (satisfies GAP-18).
 *
 * Exported for unit-testing in isolation.
 */
export function buildSchemaPrompt(
  grants: ResourceGrantSet,
  dataSourceId: string,
): string {
  // Group: schema → table → columns
  const schemaMap = new Map<string, Map<string, Set<string>>>();

  for (const grant of grants) {
    if (grant.dataSourceId !== dataSourceId) continue;

    if (!schemaMap.has(grant.schema)) {
      schemaMap.set(grant.schema, new Map());
    }
    const tableMap = schemaMap.get(grant.schema)!;

    if (grant.kind === "schema") {
      // Full-schema grant: all tables accessible (exact table names unknown without introspection)
      if (!tableMap.has("*")) tableMap.set("*", new Set());
    } else if (grant.kind === "table" && grant.table) {
      // Table grant: all columns readable — represent with "*"
      if (!tableMap.has(grant.table)) {
        tableMap.set(grant.table, new Set(["*"]));
      } else {
        tableMap.get(grant.table)!.add("*");
      }
    } else if (grant.kind === "column" && grant.table && grant.column) {
      // Column grant: only the named column
      if (!tableMap.has(grant.table)) {
        tableMap.set(grant.table, new Set());
      }
      tableMap.get(grant.table)!.add(grant.column);
    }
  }

  if (schemaMap.size === 0) {
    return "No schema access is granted for your role on this data source.";
  }

  const lines: string[] = [
    "Generate a SQL SELECT query to answer the user's question.",
    "Only reference the tables and columns listed below. Do not access any other resources.",
    "Available schema (read-only):",
    "",
  ];

  for (const [schema, tableMap] of schemaMap) {
    lines.push(`Schema: ${schema}`);
    if (tableMap.has("*")) {
      lines.push(`  [full schema access — all tables accessible]`);
    } else {
      for (const [table, columns] of tableMap) {
        const colList = columns.has("*") ? "all columns" : [...columns].join(", ");
        lines.push(`  Table: ${schema}.${table}  (columns: ${colList})`);
      }
    }
  }

  return lines.join("\n");
}

/** Map validator output to the shape expected by the query proxy. */
function toProxyQuery(validated: ValidatorQuery): ProxyQuery {
  if (validated.queryType === "sql") {
    return { kind: "sql", sql: validated.sql, params: validated.params };
  }
  return {
    kind: "rest",
    endpoint: validated.endpoint,
    fields: validated.fields,
    params: validated.queryParams,
  };
}

/**
 * Classify an unknown error from the pipeline into an error code + safe message.
 * Covers all codes from the error-codes contract: GATE_BLOCK | CLARIFICATION |
 * VALIDATION | DATA_SOURCE | LLM_ERROR | AUTH | TENANT | NOT_FOUND | RATE_LIMIT | INTERNAL.
 * Never leaks raw stack traces or credentials.
 */
function classifyError(err: unknown): { code: string; message: string } {
  // Named orchestrator / clarification errors carry their own code
  if (err instanceof LlmClarificationError) {
    return { code: "CLARIFICATION", message: err.message };
  }
  if (err instanceof OrchestratorError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    // Typed proxy / adapter errors carry a `.code` property
    if ("code" in err && typeof (err as { code: unknown }).code === "string") {
      const code = (err as { code: string }).code;
      // Allow-list: all contract error codes that are safe to surface to the client
      const allowedCodes = new Set([
        "CLARIFICATION",
        "VALIDATION",
        "DATA_SOURCE",
        "LLM_ERROR",
        "AUTH",
        "TENANT",
        "NOT_FOUND",
        "RATE_LIMIT",
        "INTERNAL",
      ]);
      if (allowedCodes.has(code)) {
        // Sanitize DB / credential error message to avoid leaking internals
        const safeMsg =
          code === "DATA_SOURCE"
            ? "Data source error — unable to execute the query."
            : err.message;
        return { code, message: safeMsg };
      }
    }
  }
  return { code: "INTERNAL", message: "An unexpected error occurred." };
}

// ── Main pipeline ──────────────────────────────────────────────────────────────

/**
 * Runs the full ask pipeline and drives SSE events via `args.send`.
 *
 * Contract:
 *   - Always emits exactly one terminal event (`done` or `error`) before returning.
 *   - Persists the user message and assistant message to the DB.
 *   - Emits an audit event on every completion (success, block, or error).
 *   - Aborts the LLM stream on `signal.aborted` (client disconnect).
 *   - Never leaks row data into the LLM context.
 */
export async function runAskPipeline(args: OrchestratorArgs): Promise<void> {
  const {
    tenantId, userId, roleId, conversationId, text, llm, send, signal, ip,
  } = args;

  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();

  // Mutable state shared across try/finally
  let assistantContent = "";
  let generatedQueryText: string | null = null;
  let resultEnvelope: ResultEnvelope | null = null;
  let auditType: AuditEventType = "query_executed";
  let auditOutcome: "success" | "blocked" | "error" = "error";
  let auditDataSourceId: string | undefined;
  let auditDetail: Record<string, unknown> = {};
  let roleName = "unknown";
  let terminalSent = false;

  const sendTerminal = (event: "done" | "error", data: unknown): void => {
    send(event, data);
    terminalSent = true;
  };

  try {
    // ── Step 1: Load context + persist user message in one transaction ──────────
    const { grants, dataSource, historyMessages } = await withTenant(
      tenantId,
      async (tx) => {
        // Persist user message first so history is captured even on pipeline error
        await addMessage(tx, {
          id: userMessageId,
          conversationId,
          role: "user",
          content: text,
        });

        // Role name for audit + PermissionBlock
        const roleRows = await tx.$queryRawUnsafe<{ name: string }[]>(
          `SELECT name FROM roles WHERE id = $1`,
          roleId,
        );
        if (!roleRows.length) {
          throw new OrchestratorError("AUTH", "Role not found");
        }
        roleName = roleRows[0].name;

        // Grants for this role (all data sources)
        const grantRows = await tx.$queryRawUnsafe<GrantRow[]>(
          `SELECT data_source_id, kind, schema, "table", "column"
           FROM resource_grants
           WHERE role_id = $1
           ORDER BY data_source_id, kind, schema, "table", "column"`,
          roleId,
        );

        // First connected data source the role has grants for
        const dsRows = await tx.$queryRawUnsafe<DataSourceRow[]>(
          `SELECT DISTINCT ds.id, ds.type
           FROM data_sources ds
           INNER JOIN resource_grants rg
             ON rg.data_source_id = ds.id AND rg.role_id = $1
           WHERE ds.status = 'connected'
           LIMIT 1`,
          roleId,
        );
        if (!dsRows.length) {
          throw new OrchestratorError(
            "DATA_SOURCE",
            "No connected data source with grants available for your role.",
          );
        }

        // Map raw grant rows → ResourceGrantSet
        const grants: ResourceGrantSet = grantRows.map((r) => ({
          roleId,
          dataSourceId: r.data_source_id,
          kind: r.kind,
          schema: r.schema,
          ...(r.table !== null ? { table: r.table } : {}),
          ...(r.column !== null ? { column: r.column } : {}),
        }));

        const historyMessages = await getHistoryWindow(
          tx,
          conversationId,
          userId,
          HISTORY_TOKEN_BUDGET,
        );

        return { grants, dataSource: dsRows[0], historyMessages };
      },
    );

    auditDataSourceId = dataSource.id;
    const dialect = typeToDialect(dataSource.type);

    // ── Step 2: Build LLM context (schema metadata only — GAP-18) ──────────────
    const schemaPrompt = buildSchemaPrompt(grants, dataSource.id);
    const history = historyMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // ── Step 3: Generate query proposal ────────────────────────────────────────
    const proposal = await llm.generateQuery({
      userMessage: text,
      history,
      systemPrompt: schemaPrompt,
    });

    generatedQueryText = proposal.query;
    const generatedQuery = { sql: proposal.query, queryType: proposal.queryType };

    // ── Step 4: Send meta event ─────────────────────────────────────────────────
    send("meta", { messageId: assistantMessageId, queryType: proposal.queryType });

    // ── Step 5: Permission gate (L1 security boundary) ──────────────────────────
    const gateResult = evaluateGate({ query: generatedQuery, grants, dialect });

    if (!gateResult.allow) {
      const block: PermissionBlock = {
        messageId: assistantMessageId,
        roleName,
        missing: gateResult.missing,
      };
      send("block", { block });
      assistantContent =
        `Query blocked: insufficient permissions for ${gateResult.missing.length} resource(s).`;
      auditType = "query_blocked";
      auditOutcome = "blocked";
      auditDetail = {
        queryText: proposal.query,
        missing: gateResult.missing,
      };
      // block is non-terminal; done follows
      sendTerminal("done", { messageId: assistantMessageId });
      return;
    }

    // ── Step 6: Query validation / injection guard ──────────────────────────────
    // Pass the gate's pre-parsed AST so the validator skips a redundant parse.
    const valResult = validateQuery(generatedQuery, { dialect, precomputedAst: gateResult.ast });
    if (!valResult.ok) {
      assistantContent = `Validation failed: ${valResult.error.message}`;
      auditType = "query_validation_failed";
      auditOutcome = "error";
      auditDetail = {
        queryText: proposal.query,
        validationError: valResult.error.message,
      };
      sendTerminal("error", {
        code: "VALIDATION",
        message: valResult.error.message,
      });
      return;
    }

    // ── Step 7: Execute via Query Proxy (L2 backstop) ──────────────────────────
    const proxyQuery = toProxyQuery(valResult.query);
    const rawResult = await proxyExecute({
      tenantId,
      roleId,
      dataSourceId: dataSource.id,
      query: proxyQuery,
    });

    // ── Step 8: Chart selection ─────────────────────────────────────────────────
    const inputCols = rawResult.columns.map((c) => ({ name: c.name, type: c.type }));
    const chartResult = selectChartType(inputCols, rawResult.rows, rawResult.rowCount);

    // ── Step 9: Build ResultEnvelope ────────────────────────────────────────────
    resultEnvelope = {
      messageId: assistantMessageId,
      queryType: proposal.queryType,
      chartType: chartResult.chartType,
      columns: chartResult.columns,
      rows: rawResult.rows,
      rowCount: rawResult.rowCount,
      truncated: rawResult.truncated,
      ...(chartResult.notes !== undefined ? { notes: chartResult.notes } : {}),
    };

    auditDetail = {
      queryText: proposal.query,
      rowCount: rawResult.rowCount,
      chartType: chartResult.chartType,
    };

    // ── Step 10: Send result event ──────────────────────────────────────────────
    send("result", { envelope: resultEnvelope });

    // ── Step 11: Stream natural-language narration tokens ──────────────────────
    // System prompt for narration uses schema metadata + result shape only — no row values.
    const narrationPrompt = [
      schemaPrompt,
      "",
      `The following SQL was executed: ${proposal.query}`,
      `It returned ${rawResult.rowCount} rows with columns: ${rawResult.columns.map((c) => c.name).join(", ")}.`,
      "Describe these results concisely. Do not enumerate individual row values.",
    ].join("\n");

    const tokenIter = llm.streamText({
      userMessage: text,
      history,
      systemPrompt: narrationPrompt,
    })[Symbol.asyncIterator]();

    try {
      while (true) {
        if (signal.aborted) break;
        const next = await tokenIter.next();
        if (next.done) break;
        if (signal.aborted) break;
        send("token", { delta: next.value });
        assistantContent += next.value;
      }
    } finally {
      // Clean up generator on early exit (client disconnect)
      await tokenIter.return?.()?.catch?.(() => undefined);
    }

    auditOutcome = "success";
    sendTerminal("done", { messageId: assistantMessageId });
  } catch (err) {
    logger.error({ err }, "orchestrator: pipeline error");
    const classified = classifyError(err);
    if (!terminalSent) {
      sendTerminal("error", classified);
    }
    auditOutcome = "error";
    auditDetail = { ...auditDetail, error: classified.message };
  } finally {
    // Persist assistant message (fire-and-forget; never fails the SSE response)
    withTenant(tenantId, (tx) =>
      addMessage(tx, {
        id: assistantMessageId,
        conversationId,
        role: "assistant",
        content: assistantContent,
        ...(generatedQueryText !== null ? { generatedQuery: generatedQueryText } : {}),
        ...(resultEnvelope !== null ? { resultEnvelope, queryType: resultEnvelope.queryType } : {}),
        ...(auditDataSourceId !== undefined ? { dataSourceId: auditDataSourceId } : {}),
      }),
    ).catch((err) => {
      logger.error({ err }, "orchestrator: failed to persist assistant message");
    });

    // Emit audit event
    emitAuditEvent({
      id: randomUUID(),
      tenantId,
      at: new Date().toISOString(),
      actorUserId: userId,
      roleNameAtEvent: roleName,
      type: auditType,
      outcome: auditOutcome,
      ...(auditDataSourceId !== undefined ? { dataSourceId: auditDataSourceId } : {}),
      detail: auditDetail,
      ...(ip !== undefined ? { ip } : {}),
    }).catch((err) => {
      logger.error({ err }, "orchestrator: failed to emit audit event");
    });
  }
}
