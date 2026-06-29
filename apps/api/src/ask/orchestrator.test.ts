/**
 * Unit tests for the Ask Orchestrator (T5.5).
 *
 * Tests cover:
 *   - buildSchemaPrompt (pure)
 *   - runAskPipeline: success, block, validation-fail, data-source-error,
 *     LLM error, clarification-style error, client disconnect, follow-up (gate re-runs)
 *
 * All I/O (DB, proxy, audit) is mocked. LLM uses MockLlmProvider.
 * Row data never appears in LLM context (GAP-18 assertion).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSchemaPrompt, runAskPipeline } from "./orchestrator.js";
import { MockLlmProvider } from "../llm/mock-provider.js";
import type { ResourceGrantSet } from "@bi/contracts";
import type { ResultEnvelope } from "@bi/contracts";

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockAddMessage = vi.fn().mockResolvedValue({});
const mockGetHistoryWindow = vi.fn().mockResolvedValue([]);
const mockProxyExecute = vi.fn();
const mockEmitAuditEvent = vi.fn().mockResolvedValue(undefined);

// withTenant: call fn with a mock tx; tx.$queryRawUnsafe / $executeRawUnsafe are
// configured per test via the mockTx helpers below.
const mockTxQueryRaw = vi.fn();
const mockTxExecuteRaw = vi.fn().mockResolvedValue(0);

const mockTx = {
  $queryRawUnsafe: mockTxQueryRaw,
  $executeRawUnsafe: mockTxExecuteRaw,
};

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(mockTx)),
}));

vi.mock("../conversations/index.js", () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  getHistoryWindow: (...args: unknown[]) => mockGetHistoryWindow(...args),
}));

vi.mock("../datasource/query-proxy.js", () => ({
  execute: (...args: unknown[]) => mockProxyExecute(...args),
}));

vi.mock("../audit/index.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeRawQueryResult() {
  return {
    columns: [
      { name: "region", type: "string" as const, role: "dimension" as const },
      { name: "total", type: "number" as const, role: "measure" as const },
    ],
    rows: [
      { region: "North", total: 1000 },
      { region: "South", total: 2000 },
    ],
    rowCount: 2,
    truncated: false,
  };
}

/** Default DB row responses for the happy path. */
function setupDefaultMockTx(roleRow = { name: "Analyst" }) {
  let call = 0;
  mockTxQueryRaw.mockImplementation(() => {
    switch (call++) {
      case 0: return Promise.resolve([roleRow]);          // SELECT name FROM roles
      case 1: return Promise.resolve([                    // SELECT resource_grants
        {
          data_source_id: "ds-1",
          kind: "table",
          schema: "sales",
          table: "orders",
          column: null,
        },
      ]);
      case 2: return Promise.resolve([                    // SELECT data_sources (connected)
        { id: "ds-1", type: "postgres" },
      ]);
      default: return Promise.resolve([]);
    }
  });
}

// ── Captured events helper ─────────────────────────────────────────────────────

function captureSend(): { events: Array<{ event: string; data: unknown }>; send: (event: string, data: unknown) => void } {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    events,
    send: (event: string, data: unknown) => events.push({ event, data }),
  };
}

// ── buildSchemaPrompt ──────────────────────────────────────────────────────────

describe("buildSchemaPrompt", () => {
  it("returns no-access message when no grants for data source", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "other-ds", kind: "table", schema: "s", table: "t" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    expect(result).toContain("No schema access");
  });

  it("includes schema and table from table grant", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "ds-1", kind: "table", schema: "sales", table: "orders" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    expect(result).toContain("Schema: sales");
    expect(result).toContain("orders");
    expect(result).toContain("all columns");
  });

  it("lists specific columns from column grants", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "ds-1", kind: "column", schema: "sales", table: "orders", column: "amount" },
      { roleId: "r1", dataSourceId: "ds-1", kind: "column", schema: "sales", table: "orders", column: "status" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    expect(result).toContain("amount");
    expect(result).toContain("status");
  });

  it("notes full schema access for schema-level grants", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "ds-1", kind: "schema", schema: "analytics" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    expect(result).toContain("Schema: analytics");
    expect(result).toContain("full schema access");
  });

  it("filters out grants for other data sources", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "ds-1", kind: "table", schema: "a", table: "t1" },
      { roleId: "r1", dataSourceId: "ds-2", kind: "table", schema: "b", table: "t2" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    expect(result).toContain("Schema: a");
    expect(result).not.toContain("Schema: b");
  });

  it("never includes row data (GAP-18 assertion — prompt is schema-only)", () => {
    const grants: ResourceGrantSet = [
      { roleId: "r1", dataSourceId: "ds-1", kind: "table", schema: "sales", table: "revenue" },
    ];
    const result = buildSchemaPrompt(grants, "ds-1");
    // No row values (numbers, records) should appear — only metadata
    expect(result).not.toMatch(/\brow\s+\d+/i);
    expect(result).not.toMatch(/SELECT.*FROM.*WHERE.*=/i);
  });
});

// ── runAskPipeline: success path ───────────────────────────────────────────────

describe("runAskPipeline — success", () => {
  let llm: MockLlmProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLlmProvider();
    llm.queryProposal = {
      queryType: "sql",
      query: "SELECT region, SUM(total) FROM sales.orders GROUP BY region",
      referencedResources: [],
    };
    llm.textChunks = ["Here ", "are ", "the results."];
    mockProxyExecute.mockResolvedValue(makeRawQueryResult());
    setupDefaultMockTx();
    // History window returns empty by default
    mockGetHistoryWindow.mockResolvedValue([]);
  });

  it("emits events in order: meta → result → token... → done", async () => {
    const { events, send } = captureSend();
    const ac = new AbortController();

    await runAskPipeline({
      tenantId: "t1",
      userId: "u1",
      roleId: "role-1",
      conversationId: "conv-1",
      text: "Sales by region?",
      llm,
      send,
      signal: ac.signal,
    });

    const names = events.map((e) => e.event);
    expect(names).toContain("meta");
    expect(names).toContain("result");
    expect(names).toContain("token");
    expect(names).toContain("done");
    // Order: meta before result, result before done
    const metaIdx = names.indexOf("meta");
    const resultIdx = names.indexOf("result");
    const doneIdx = names.lastIndexOf("done");
    expect(metaIdx).toBeLessThan(resultIdx);
    expect(resultIdx).toBeLessThan(doneIdx);
    // No error event on success
    expect(names).not.toContain("error");
  });

  it("meta event carries messageId and queryType", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const meta = events.find((e) => e.event === "meta")!;
    expect(meta.data).toMatchObject({ messageId: expect.any(String), queryType: "sql" });
  });

  it("result event carries a valid ResultEnvelope", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const resultEvent = events.find((e) => e.event === "result")!;
    const envelope = (resultEvent.data as { envelope: ResultEnvelope }).envelope;
    expect(envelope.queryType).toBe("sql");
    expect(envelope.columns).toHaveLength(2);
    expect(envelope.rowCount).toBe(2);
    expect(envelope.truncated).toBe(false);
    expect(["bar", "line", "pie", "table"]).toContain(envelope.chartType);
    expect(typeof envelope.messageId).toBe("string");
  });

  it("token events carry delta strings from the LLM stream", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const tokens = events.filter((e) => e.event === "token");
    const combined = tokens.map((e) => (e.data as { delta: string }).delta).join("");
    expect(combined).toBe("Here are the results.");
  });

  it("persists user message before LLM call (addMessage called with role=user)", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Sales by region?", llm, send, signal: new AbortController().signal,
    });
    // addMessage is called at least twice (user + assistant)
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "user", content: "Sales by region?" }),
    );
  });

  it("persists assistant message with generatedQuery and resultEnvelope", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    // Give fire-and-forget persist time to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: "assistant",
        generatedQuery: expect.stringContaining("SELECT"),
        resultEnvelope: expect.objectContaining({ rowCount: 2 }),
      }),
    );
  });

  it("emits a query_executed audit event with success outcome", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "query_executed",
        outcome: "success",
        actorUserId: "u1",
      }),
    );
  });

  it("LLM context systemPrompt contains schema metadata (GAP-18 — no row data)", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const generateCall = llm.calls.find((c) => c.method === "generateQuery")!;
    // System prompt must contain schema metadata
    expect(generateCall.input.systemPrompt).toContain("sales");
    // System prompt must NOT contain actual row values (row data = PII risk)
    // Check the raw result rows are not in the prompt
    expect(generateCall.input.systemPrompt).not.toContain("1000");
    expect(generateCall.input.systemPrompt).not.toContain("2000");
  });

  it("injects windowed history into LLM calls", async () => {
    mockGetHistoryWindow.mockResolvedValue([
      { id: "m0", conversationId: "conv-1", role: "user", content: "Prior question", queryType: null, generatedQuery: null, resultEnvelope: null, createdAt: new Date().toISOString() },
      { id: "m1", conversationId: "conv-1", role: "assistant", content: "Prior answer", queryType: null, generatedQuery: null, resultEnvelope: null, createdAt: new Date().toISOString() },
    ]);

    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "New question", llm, send, signal: new AbortController().signal,
    });

    const generateCall = llm.calls.find((c) => c.method === "generateQuery")!;
    expect(generateCall.input.history).toHaveLength(2);
    expect(generateCall.input.history![0]).toMatchObject({ role: "user", content: "Prior question" });
  });
});

// ── runAskPipeline: permission block ──────────────────────────────────────────

describe("runAskPipeline — permission block", () => {
  let llm: MockLlmProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLlmProvider();
    // LLM asks for a table the role has no access to
    llm.queryProposal = {
      queryType: "sql",
      query: "SELECT secret FROM admin.secrets",
      referencedResources: [],
    };
    mockGetHistoryWindow.mockResolvedValue([]);
    setupDefaultMockTx(); // role grants only cover sales.orders
  });

  it("emits block event when gate denies", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send, signal: new AbortController().signal,
    });
    const names = events.map((e) => e.event);
    expect(names).toContain("block");
  });

  it("block is followed by done (block is non-terminal)", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send, signal: new AbortController().signal,
    });
    const names = events.map((e) => e.event);
    const blockIdx = names.indexOf("block");
    const doneIdx = names.lastIndexOf("done");
    expect(blockIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(blockIdx);
  });

  it("block event carries PermissionBlock with missing[] and roleName", async () => {
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send, signal: new AbortController().signal,
    });
    const blockEvent = events.find((e) => e.event === "block")!;
    const block = (blockEvent.data as { block: { roleName: string; missing: unknown[] } }).block;
    expect(block.roleName).toBe("Analyst");
    expect(Array.isArray(block.missing)).toBe(true);
    expect(block.missing.length).toBeGreaterThan(0);
  });

  it("does NOT execute the query when blocked (proxy never called)", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send, signal: new AbortController().signal,
    });
    expect(mockProxyExecute).not.toHaveBeenCalled();
  });

  it("emits query_blocked audit event with blocked outcome", async () => {
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send, signal: new AbortController().signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "query_blocked", outcome: "blocked" }),
    );
  });

  it("gate re-runs on follow-up (never caches authorization)", async () => {
    // First call: blocked
    const { send: send1 } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Show secrets", llm, send: send1, signal: new AbortController().signal,
    });

    // Second call (follow-up): still blocked (gate always re-runs)
    vi.clearAllMocks();
    setupDefaultMockTx();
    mockGetHistoryWindow.mockResolvedValue([]);
    const llm2 = new MockLlmProvider();
    llm2.queryProposal = {
      queryType: "sql",
      query: "SELECT secret FROM admin.secrets",
      referencedResources: [],
    };
    const { events: events2, send: send2 } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "Still show secrets", llm: llm2, send: send2, signal: new AbortController().signal,
    });
    const names2 = events2.map((e) => e.event);
    expect(names2).toContain("block");
    expect(mockProxyExecute).not.toHaveBeenCalled();
  });
});

// ── runAskPipeline: validation failure ────────────────────────────────────────

describe("runAskPipeline — validation failure", () => {
  let llm: MockLlmProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLlmProvider();
    mockGetHistoryWindow.mockResolvedValue([]);
    setupDefaultMockTx();
  });

  it("emits error with VALIDATION code when LLM generates DML", async () => {
    llm.queryProposal = {
      queryType: "sql",
      query: "DELETE FROM sales.orders WHERE 1=1",
      referencedResources: [],
    };
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const errorEvent = events.find((e) => e.event === "error")!;
    expect(errorEvent.data).toMatchObject({ code: "VALIDATION" });
  });

  it("does not execute when validation fails", async () => {
    llm.queryProposal = {
      queryType: "sql",
      query: "DROP TABLE sales.orders",
      referencedResources: [],
    };
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    expect(mockProxyExecute).not.toHaveBeenCalled();
  });

  it("emits query_validation_failed audit event", async () => {
    llm.queryProposal = {
      queryType: "sql",
      query: "INSERT INTO sales.orders VALUES (1)",
      referencedResources: [],
    };
    const { send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "query_validation_failed", outcome: "error" }),
    );
  });
});

// ── runAskPipeline: data-source error ─────────────────────────────────────────

describe("runAskPipeline — data-source error", () => {
  let llm: MockLlmProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLlmProvider();
    llm.queryProposal = {
      queryType: "sql",
      query: "SELECT region, SUM(total) FROM sales.orders GROUP BY region",
      referencedResources: [],
    };
    mockGetHistoryWindow.mockResolvedValue([]);
    setupDefaultMockTx();
  });

  it("emits error event when proxy throws", async () => {
    const dsErr = Object.assign(new Error("connection refused"), { code: "DATA_SOURCE" });
    mockProxyExecute.mockRejectedValue(dsErr);

    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const errorEvent = events.find((e) => e.event === "error")!;
    expect(errorEvent.data).toMatchObject({ code: "DATA_SOURCE" });
  });

  it("always emits a terminal event even when proxy throws", async () => {
    mockProxyExecute.mockRejectedValue(new Error("timeout"));
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const terminals = events.filter((e) => e.event === "error" || e.event === "done");
    expect(terminals).toHaveLength(1);
  });
});

// ── runAskPipeline: LLM / clarification error ─────────────────────────────────

describe("runAskPipeline — LLM error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistoryWindow.mockResolvedValue([]);
    setupDefaultMockTx();
  });

  it("emits error event when generateQuery throws", async () => {
    const llm = new MockLlmProvider();
    llm.queryError = new Error("LLM unavailable");

    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const terminals = events.filter((e) => e.event === "error" || e.event === "done");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("error");
  });

  it("emits error when streamText throws after result sent", async () => {
    const llm = new MockLlmProvider();
    llm.queryProposal = {
      queryType: "sql",
      query: "SELECT region, SUM(total) FROM sales.orders GROUP BY region",
      referencedResources: [],
    };
    llm.streamError = new Error("stream failure");
    mockProxyExecute.mockResolvedValue(makeRawQueryResult());

    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    // result was sent before streaming started
    const names = events.map((e) => e.event);
    expect(names).toContain("result");
    // A terminal event must always be emitted
    const terminals = names.filter((n) => n === "done" || n === "error");
    expect(terminals).toHaveLength(1);
  });
});

// ── runAskPipeline: OrchestratorError (no role / no data source) ──────────────

describe("runAskPipeline — orchestrator setup errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistoryWindow.mockResolvedValue([]);
  });

  it("emits error when role is not found in DB", async () => {
    let call = 0;
    mockTxQueryRaw.mockImplementation(() => {
      switch (call++) {
        case 0: return Promise.resolve([]);          // roles → empty
        default: return Promise.resolve([]);
      }
    });

    const llm = new MockLlmProvider();
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-ghost", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const terminals = events.filter((e) => e.event === "error" || e.event === "done");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].event).toBe("error");
  });

  it("emits error when no connected data source available", async () => {
    let call = 0;
    mockTxQueryRaw.mockImplementation(() => {
      switch (call++) {
        case 0: return Promise.resolve([{ name: "Analyst" }]);   // role
        case 1: return Promise.resolve([{                        // grants
          data_source_id: "ds-1", kind: "table", schema: "s", table: "t", column: null,
        }]);
        case 2: return Promise.resolve([]);                      // data_sources → none connected
        default: return Promise.resolve([]);
      }
    });

    const llm = new MockLlmProvider();
    const { events, send } = captureSend();
    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: new AbortController().signal,
    });
    const errEvent = events.find((e) => e.event === "error")!;
    expect(errEvent).toBeDefined();
    expect(errEvent.data).toMatchObject({ code: "DATA_SOURCE" });
  });
});

// ── runAskPipeline: client disconnect ─────────────────────────────────────────

describe("runAskPipeline — client disconnect / abort", () => {
  it("stops streaming tokens when signal is aborted", async () => {
    vi.clearAllMocks();
    setupDefaultMockTx();
    mockGetHistoryWindow.mockResolvedValue([]);
    mockProxyExecute.mockResolvedValue(makeRawQueryResult());

    const llm = new MockLlmProvider();
    llm.queryProposal = {
      queryType: "sql",
      query: "SELECT region, SUM(total) FROM sales.orders GROUP BY region",
      referencedResources: [],
    };
    // 5 chunks; we'll abort after the first
    llm.textChunks = ["chunk1", "chunk2", "chunk3", "chunk4", "chunk5"];

    const ac = new AbortController();
    const { events, send: rawSend } = captureSend();

    // Abort after the result event is seen
    const send = (event: string, data: unknown) => {
      rawSend(event, data);
      if (event === "result") {
        ac.abort();
      }
    };

    await runAskPipeline({
      tenantId: "t1", userId: "u1", roleId: "role-1", conversationId: "conv-1",
      text: "q", llm, send, signal: ac.signal,
    });

    const tokens = events.filter((e) => e.event === "token");
    // Not all 5 tokens should have been sent (aborted early)
    expect(tokens.length).toBeLessThan(5);
  });
});
