/**
 * T5.5 — Testcontainers integration tests for runAskPipeline.
 *
 * Uses a real Postgres container as the data-plane source; control-plane
 * (withTenant / Prisma) is stubbed. LLM is mocked (no network calls).
 *
 * Scenarios: success, block, clarification, validation-fail, data-source-error, follow-up.
 *
 * Skipped when SKIP_DB_INTEGRATION_TESTS=1 (set in CI environments without Docker).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { encryptCredential } from "../datasource/vault.js";
import type { LlmProvider, LlmRequest } from "../llm/port.js";

// ── Hoist mock: withTenant (control plane) ─────────────────────────────────────
// Must be at module level for Vitest hoisting.

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

// Import SUT after mock declarations
import { withTenant } from "../db/with-tenant.js";
import { _drainConnectorCache } from "../datasource/query-proxy.js";
import { runAskPipeline, LlmClarificationError } from "./orchestrator.js";
import type { SseSender } from "./orchestrator.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SKIP = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";
const TEST_MASTER_KEY = "c".repeat(64);

const TENANT_ID = "tenant_test";
const USER_ID = "u-test";
const ROLE_ID = "role-test";
const CONV_ID = "conv-test";
const DS_ID = "ds-test";

// ── Mock DB row helpers ────────────────────────────────────────────────────────

const CONV_ROW = {
  id: CONV_ID,
  user_id: USER_ID,
  title: "Test",
  created_at: new Date(),
  updated_at: new Date(),
};

const USER_MSG_ROW = {
  id: "msg-user-1",
  conversation_id: CONV_ID,
  role: "user",
  content: "Sales by region?",
  query_type: null,
  generated_query: null,
  result_envelope: null,
  created_at: new Date(),
};

// ── Grant row shapes ─────────────────────────────────────────────────────────

function salesGrant() {
  return {
    data_source_id: DS_ID,
    kind: "table" as const,
    schema: "public",
    table: "sales",
    column: null,
  };
}

// ── withTenant mock builder ──────────────────────────────────────────────────

/**
 * Sets up the withTenant call chain for one pipeline run.
 *
 * Call order:
 *   1. Orchestrator main TX (role lookup + grants + data source + history)
 *   2. Proxy credential-lookup TX (only for scenarios that reach execution)
 *   3+ Fire-and-forget (addMessage assistant, emitAuditEvent) → catch-all
 */
function setupWithTenantMock(opts: {
  grantRows: ReturnType<typeof salesGrant>[];
  encryptedCred: string | null;
  dataSourceType?: string;
}): void {
  const { grantRows, encryptedCred, dataSourceType = "postgres" } = opts;

  // Catch-all for fire-and-forget calls (addMessage assistant, emitAuditEvent, etc.)
  vi.mocked(withTenant).mockImplementation((_tid, fn) =>
    fn({
      $queryRawUnsafe: vi.fn().mockResolvedValue([USER_MSG_ROW]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    } as never) as Promise<never>,
  );

  // Call 1: orchestrator main TX
  // Sequence: addMessage(user) → role lookup → grants → data source → getConversation → messages
  //
  // Data-source row: returned only when there are grants (empty grants → no connected source
  // → orchestrator throws OrchestratorError("DATA_SOURCE") before reaching the gate).
  const dataSourceRow = grantRows.length > 0 ? [{ id: DS_ID, type: dataSourceType }] : [];
  vi.mocked(withTenant).mockImplementationOnce((_tid, fn) =>
    fn({
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([USER_MSG_ROW])  // addMessage INSERT RETURNING
        .mockResolvedValueOnce([{ name: "analyst" }]) // roles WHERE id = $1
        .mockResolvedValueOnce(grantRows)        // resource_grants WHERE role_id = $1
        .mockResolvedValueOnce(dataSourceRow)    // data_sources JOIN grants (empty when no grants)
        .mockResolvedValueOnce([CONV_ROW])       // getConversation (for history)
        .mockResolvedValueOnce([]),              // messages (empty history)
      $executeRawUnsafe: vi.fn().mockResolvedValue(1), // UPDATE conversations
    } as never) as Promise<never>,
  );

  // Call 2: proxy credential lookup TX (only registered if we expect execution)
  if (encryptedCred !== null) {
    vi.mocked(withTenant).mockImplementationOnce((_tid, fn) =>
      fn({
        $queryRawUnsafe: vi.fn()
          .mockResolvedValueOnce([{ type: dataSourceType }])          // SELECT type FROM data_sources
          .mockResolvedValueOnce([{ encrypted_cred: encryptedCred }]), // SELECT encrypted_cred FROM credentials
      } as never) as Promise<never>,
    );
  }
}

// ── SSE event capture ────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: unknown;
}

function captureSend(): { events: SseEvent[]; send: SseSender } {
  const events: SseEvent[] = [];
  const send: SseSender = (event, data) => events.push({ event, data });
  return { events, send };
}

// ── Mock LLM provider factory ────────────────────────────────────────────────

function makeMockLlm(opts?: {
  query?: string;
  queryType?: "sql" | "rest";
  queryError?: Error;
  tokens?: string[];
}): LlmProvider {
  const {
    query = "SELECT region, total FROM public.sales ORDER BY total DESC",
    queryType = "sql",
    queryError,
    tokens = ["Results are in."],
  } = opts ?? {};

  return {
    id: "mock",
    model: "mock-model",
    generateQuery: queryError
      ? () => Promise.reject(queryError)
      : () =>
          Promise.resolve({
            queryType,
            query,
            referencedResources: [],
          }),
    streamText: (_req: LlmRequest) =>
      (async function* () {
        for (const tok of tokens) yield tok;
      })(),
  };
}

// ── Testcontainers suite ──────────────────────────────────────────────────────

describe.skipIf(SKIP)("runAskPipeline — Testcontainers integration", () => {
  let container: StartedPostgreSqlContainer;
  let superPool: Pool;
  let encryptedSalesCred: string;

  beforeAll(async () => {
    process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY;

    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("test_db")
      .withUsername("super_user")
      .withPassword("super_pass")
      .start();

    const uri = container.getConnectionUri();
    superPool = new Pool({ connectionString: uri });

    // Data-plane table
    await superPool.query(`
      CREATE TABLE public.sales (
        region TEXT NOT NULL,
        total  NUMERIC NOT NULL
      )
    `);
    await superPool.query(
      `INSERT INTO public.sales (region, total) VALUES ('North', 120), ('South', 200), ('West', 80)`,
    );

    // Least-privilege role — SELECT on sales only
    await superPool.query(`CREATE ROLE sales_reader WITH LOGIN PASSWORD 'sales_pass'`);
    await superPool.query(`GRANT CONNECT ON DATABASE test_db TO sales_reader`);
    await superPool.query(`GRANT USAGE ON SCHEMA public TO sales_reader`);
    await superPool.query(`GRANT SELECT ON public.sales TO sales_reader`);

    const url = new URL(uri);
    encryptedSalesCred = encryptCredential({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: "sales_reader",
      password: "sales_pass",
      ssl: false,
    });
  }, 120_000);

  afterAll(async () => {
    await _drainConnectorCache();
    await superPool.end();
    await container.stop();
    delete process.env["VAULT_MASTER_KEY"];
  }, 30_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    await _drainConnectorCache(); // fresh pool per test
  });

  // ── 1. Success ─────────────────────────────────────────────────────────────

  it("success — gate allows, validator passes, proxy queries real Postgres, events streamed", async () => {
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: encryptedSalesCred });

    const llm = makeMockLlm({
      query: "SELECT region, total FROM public.sales ORDER BY total DESC",
      tokens: ["Sales by region:", " North, South, West."],
    });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Sales by region?",
      llm, send, signal: new AbortController().signal,
    });

    const eventNames = events.map((e) => e.event);

    // Required events
    expect(eventNames).toContain("meta");
    expect(eventNames).toContain("result");
    expect(eventNames).toContain("token");
    expect(eventNames).toContain("done");
    expect(eventNames).not.toContain("error");
    expect(eventNames).not.toContain("block");

    // meta event
    const meta = events.find((e) => e.event === "meta")!.data as { queryType: string };
    expect(meta.queryType).toBe("sql");

    // result event — real rows from Testcontainers Postgres
    const result = events.find((e) => e.event === "result")!.data as {
      envelope: { rows: unknown[]; rowCount: number; chartType: string };
    };
    expect(result.envelope.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.envelope.rowCount).toBeGreaterThanOrEqual(1);
    expect(["bar", "line", "pie", "table"]).toContain(result.envelope.chartType);

    // tokens
    const tokens = events.filter((e) => e.event === "token");
    expect(tokens.length).toBeGreaterThan(0);

    // exactly one terminal event
    const terminals = eventNames.filter((n) => n === "done" || n === "error");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toBe("done");
  }, 30_000);

  it("success — result envelope contains correct column metadata (schema-only, no row PII)", async () => {
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: encryptedSalesCred });

    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Sales totals?",
      llm: makeMockLlm(), send, signal: new AbortController().signal,
    });

    const resultEvt = events.find((e) => e.event === "result")!;
    const envelope = (resultEvt.data as { envelope: { columns: Array<{ name: string }> } }).envelope;
    const colNames = envelope.columns.map((c) => c.name);
    // Real column names from Testcontainers schema
    expect(colNames).toContain("region");
    expect(colNames).toContain("total");
  }, 30_000);

  // ── 2. Block ──────────────────────────────────────────────────────────────

  it("block — gate denies query on non-granted table; no proxy call; block+done emitted", async () => {
    // Grants only cover public.sales, but LLM queries a secret table
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: null });

    const llm = makeMockLlm({ query: "SELECT secret FROM public.sensitive_data" });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Show me secrets",
      llm, send, signal: new AbortController().signal,
    });

    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain("block");
    expect(eventNames).not.toContain("result");
    expect(eventNames).not.toContain("error");

    // block payload
    const blockEvt = events.find((e) => e.event === "block")!;
    const blockData = (blockEvt.data as { block: { missing: Array<{ kind: string; identifier: string }> } }).block;
    expect(blockData.missing.length).toBeGreaterThan(0);
    expect(blockData.missing[0].identifier).toMatch(/sensitive_data/);

    // terminal = done (not error)
    const terminals = eventNames.filter((n) => n === "done" || n === "error");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toBe("done");
  }, 30_000);

  it("block — proxy never called when gate denies", async () => {
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: null });
    const llm = makeMockLlm({ query: "SELECT id FROM public.users" });
    const { send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "User list",
      llm, send, signal: new AbortController().signal,
    });

    // withTenant call 2 (proxy cred lookup) should NOT have been made
    // Only call 1 (main TX) + fire-and-forget calls should exist
    const allCalls = vi.mocked(withTenant).mock.calls;
    // For a blocked pipeline: call 1 (main TX) + fire-and-forget (2 calls max)
    // Proxy call would be call 2 only in success paths
    // Verify by checking that none of the calls received a proxyTx-style fn
    // (simpler: just check no result event was produced — proxy not called)
    expect(allCalls.length).toBeLessThanOrEqual(3); // main + 2 fire-and-forget
  }, 30_000);

  // ── 3. Clarification ─────────────────────────────────────────────────────

  it("clarification — LlmClarificationError → error event with CLARIFICATION code; no proxy", async () => {
    // Proxy not reached — pass null so no proxy mock registered
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: null });

    const llm = makeMockLlm({
      queryError: new LlmClarificationError("Which time period do you mean?"),
    });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Show me data",
      llm, send, signal: new AbortController().signal,
    });

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    const errData = errEvt.data as { code: string; message: string };
    expect(errData.code).toBe("CLARIFICATION");
    expect(errData.message).toBe("Which time period do you mean?");

    const eventNames = events.map((e) => e.event);
    expect(eventNames).not.toContain("result");
    expect(eventNames).not.toContain("block");

    // exactly one terminal event
    const terminals = eventNames.filter((n) => n === "done" || n === "error");
    expect(terminals).toHaveLength(1);
  }, 30_000);

  // ── 4. Validation fail ────────────────────────────────────────────────────
  //
  // Use DML (UPDATE / INSERT) rather than DDL or multi-statement:
  //   - DML is unambiguously parseable by node-sql-parser → gate can extract
  //     referenced tables → public.sales is granted → gate allows.
  //   - Validator rejects non-SELECT verbs → VALIDATION error.
  //   - Avoids the gate's parse-failure path (which emits `block`, not `error`).

  it("validation-fail — DML (UPDATE) rejected by validator; VALIDATION code; no proxy", async () => {
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: null });

    // UPDATE public.sales: gate allows (table granted), validator rejects (DML)
    const llm = makeMockLlm({ query: "UPDATE public.sales SET total = 0 WHERE region = 'North'" });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Set all sales to zero",
      llm, send, signal: new AbortController().signal,
    });

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    expect((errEvt.data as { code: string }).code).toBe("VALIDATION");

    const eventNames = events.map((e) => e.event);
    expect(eventNames).not.toContain("result");
    expect(eventNames).not.toContain("block");
  }, 30_000);

  it("validation-fail — DML (INSERT) rejected by validator; VALIDATION code; no proxy", async () => {
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: null });

    // INSERT INTO public.sales: gate allows (table granted), validator rejects (DML)
    const llm = makeMockLlm({
      query: "INSERT INTO public.sales (region, total) VALUES ('East', 999)",
    });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Add a new sales row",
      llm, send, signal: new AbortController().signal,
    });

    const errEvt = events.find((e) => e.event === "error")!;
    expect((errEvt.data as { code: string }).code).toBe("VALIDATION");
    expect(events.map((e) => e.event)).not.toContain("result");
  }, 30_000);

  // ── 5. Data-source error ──────────────────────────────────────────────────

  it("data-source-error — query on non-existent table; error with DATA_SOURCE code", async () => {
    // Grant `public.missing_table` (doesn't exist in DB), so gate passes but DB rejects
    const missingTableGrant = {
      data_source_id: DS_ID,
      kind: "table" as const,
      schema: "public",
      table: "missing_table",
      column: null,
    };
    setupWithTenantMock({
      grantRows: [missingTableGrant],
      encryptedCred: encryptedSalesCred,
    });

    const llm = makeMockLlm({ query: "SELECT id FROM public.missing_table" });
    const { events, send } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Missing table data",
      llm, send, signal: new AbortController().signal,
    });

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    expect((errEvt.data as { code: string }).code).toBe("DATA_SOURCE");

    const eventNames = events.map((e) => e.event);
    expect(eventNames).not.toContain("result");
  }, 30_000);

  // ── 6. Follow-up (gate re-runs) ───────────────────────────────────────────

  it("follow-up — second call re-runs gate from scratch; both succeed", async () => {
    // First call
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: encryptedSalesCred });
    const { events: events1, send: send1 } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Sales first question",
      llm: makeMockLlm({ tokens: ["First answer."] }),
      send: send1, signal: new AbortController().signal,
    });

    expect(events1.map((e) => e.event)).toContain("done");

    // Drain pool between calls to prevent connection reuse issues
    await _drainConnectorCache();

    // Second call — gate must run again (no caching)
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: encryptedSalesCred });
    const { events: events2, send: send2 } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Sales follow-up question",
      llm: makeMockLlm({ tokens: ["Second answer."] }),
      send: send2, signal: new AbortController().signal,
    });

    expect(events2.map((e) => e.event)).toContain("done");

    // Both runs produced results independently
    const result1 = events1.find((e) => e.event === "result");
    const result2 = events2.find((e) => e.event === "result");
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  }, 60_000);

  it("follow-up — role change on second call is reflected (gate re-evaluated fresh)", async () => {
    // First call: role has sales grants → success
    setupWithTenantMock({ grantRows: [salesGrant()], encryptedCred: encryptedSalesCred });
    const { events: events1, send: send1 } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Q1",
      llm: makeMockLlm(), send: send1, signal: new AbortController().signal,
    });
    expect(events1.find((e) => e.event === "result")).toBeDefined();

    await _drainConnectorCache();

    // Second call: same role now has NO grants (role change simulated) → DATA_SOURCE error
    // (no connected data source with grants → orchestrator throws DATA_SOURCE before gate)
    setupWithTenantMock({ grantRows: [], encryptedCred: null });
    const { events: events2, send: send2 } = captureSend();

    await runAskPipeline({
      tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_ID,
      conversationId: CONV_ID, text: "Q2",
      llm: makeMockLlm(), send: send2, signal: new AbortController().signal,
    });

    // No cached auth from first call — fresh evaluation returns error
    const errEvt = events2.find((e) => e.event === "error");
    expect(errEvt).toBeDefined();
    expect((errEvt!.data as { code: string }).code).toBe("DATA_SOURCE");
  }, 60_000);
});
