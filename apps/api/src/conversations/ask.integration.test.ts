/**
 * Integration tests for POST /api/conversations/:id/messages (SSE endpoint).
 * Uses mock LLM provider + mock pipeline — no Testcontainers required.
 *
 * Scenarios: success, block, clarification, validation-fail, data-source-error, follow-up.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";

// ── Hoist module mocks ────────────────────────────────────────────────────────
// vi.mock calls are hoisted before imports, so these intercept the router's deps.

vi.mock("../ask/orchestrator.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ask/orchestrator.js")>();
  return {
    ...actual,
    runAskPipeline: vi.fn(),
  };
});

vi.mock("../llm/factory.js", () => ({
  createLlmProvider: vi.fn(() => ({
    id: "mock",
    model: "mock-model",
    streamText: vi.fn(),
    generateQuery: vi.fn(),
  })),
}));

// Import after mocks are registered
import { conversationsRouter } from "./router.js";
import { runAskPipeline } from "../ask/orchestrator.js";
import type { OrchestratorArgs } from "../ask/orchestrator.js";

const mockPipeline = vi.mocked(runAskPipeline);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AUTH: AuthContext = { userId: "user-1", tenantId: "tenant1", roleId: "role-1" };

const CONV_ROW = {
  id: "conv-1",
  user_id: "user-1",
  title: "Test",
  created_at: new Date("2025-01-01T00:00:00Z"),
  updated_at: new Date("2025-01-01T00:00:00Z"),
};

/** Minimal ResultEnvelope for success tests. */
const RESULT_ENVELOPE = {
  messageId: "msg-out-1",
  queryType: "sql",
  chartType: "table",
  columns: [{ name: "region", type: "string", role: "dimension" }],
  rows: [{ region: "North" }],
  rowCount: 1,
  truncated: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse SSE text into a typed event list. */
function parseSse(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event: "));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (eventLine && dataLine) {
      events.push({
        event: eventLine.slice(7).trim(),
        data: JSON.parse(dataLine.slice(6)),
      });
    }
  }
  return events;
}

/** Build an express app with injected auth + mock DB stub for ownership check. */
function buildApp(
  auth: AuthContext,
  queryStub: (sql: string, ...args: unknown[]) => unknown = () => [CONV_ROW],
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) =>
          Promise.resolve(queryStub(sql, ...args)),
        ),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/conversations", conversationsRouter);
  return app;
}

/** POST the SSE route and return parsed events. */
async function askSse(
  app: Application,
  convId: string,
  text: string,
): Promise<{ status: number; headers: Record<string, string>; events: Array<{ event: string; data: unknown }> }> {
  const res = await request(app)
    .post(`/api/conversations/${convId}/messages`)
    .send({ text });
  return {
    status: res.status,
    headers: res.headers as Record<string, string>,
    events: parseSse(res.text),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/conversations/:id/messages — SSE route wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Pre-flight HTTP errors (no SSE) ──────────────────────────────────────

  it("400 VALIDATION — missing text in body", async () => {
    const app = buildApp(AUTH);
    const res = await request(app)
      .post("/api/conversations/conv-1/messages")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("400 VALIDATION — id param too long", async () => {
    const app = buildApp(AUTH);
    const res = await request(app)
      .post(`/api/conversations/${"x".repeat(129)}/messages`)
      .send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("403 AUTH — no roleId on auth context", async () => {
    const authNoRole: AuthContext = { userId: "u1", tenantId: "t1", roleId: null as unknown as string };
    const app = buildApp(authNoRole);
    const res = await request(app)
      .post("/api/conversations/conv-1/messages")
      .send({ text: "Sales?" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("404 NOT_FOUND — conversation not owned by caller", async () => {
    const app = buildApp(AUTH, () => []); // ownership check returns no rows
    const res = await request(app)
      .post("/api/conversations/conv-999/messages")
      .send({ text: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  // ── SSE headers ──────────────────────────────────────────────────────────

  it("sends correct SSE headers", async () => {
    mockPipeline.mockResolvedValue(undefined);
    const app = buildApp(AUTH);
    const { status, headers } = await askSse(app, "conv-1", "test");
    expect(status).toBe(200);
    expect(headers["content-type"]).toMatch(/text\/event-stream/);
    expect(headers["cache-control"]).toMatch(/no-cache/);
    expect(headers["x-accel-buffering"]).toBe("no");
  });

  // ── Success scenario ──────────────────────────────────────────────────────

  it("success — meta + token + result + done events in order", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("meta", { messageId: "msg-out-1", queryType: "sql" });
      send("token", { delta: "Here are sales by region." });
      send("result", { envelope: RESULT_ENVELOPE });
      send("done", { messageId: "msg-out-1" });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "Show me sales by region");

    const names = events.map((e) => e.event);
    expect(names).toEqual(["meta", "token", "result", "done"]);
    expect(events[0].data).toMatchObject({ queryType: "sql" });
    expect(events[1].data).toMatchObject({ delta: "Here are sales by region." });
    expect(events[2].data).toMatchObject({ envelope: { chartType: "table", rowCount: 1 } });
    expect(events[3].data).toMatchObject({ messageId: "msg-out-1" });
  });

  it("success — pipeline called with correct tenantId/userId/roleId/conversationId", async () => {
    let capturedArgs: OrchestratorArgs | undefined;
    mockPipeline.mockImplementationOnce(async (args: OrchestratorArgs) => {
      capturedArgs = args;
      args.send("done", { messageId: "m1" });
    });

    const app = buildApp(AUTH);
    await askSse(app, "conv-1", "Top products?");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.tenantId).toBe("tenant1");
    expect(capturedArgs!.userId).toBe("user-1");
    expect(capturedArgs!.roleId).toBe("role-1");
    expect(capturedArgs!.conversationId).toBe("conv-1");
    expect(capturedArgs!.text).toBe("Top products?");
  });

  // ── Block scenario ────────────────────────────────────────────────────────

  it("block — emits block event then done, no result", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("meta", { messageId: "msg-block-1", queryType: "sql" });
      send("block", {
        block: {
          messageId: "msg-block-1",
          roleName: "analyst",
          missing: [{ kind: "table", identifier: "sales.orders", accessNeeded: "read" }],
        },
      });
      send("done", { messageId: "msg-block-1" });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "SELECT * FROM secret_table");

    const names = events.map((e) => e.event);
    expect(names).toContain("block");
    expect(names).not.toContain("result");
    const blockEvt = events.find((e) => e.event === "block")!;
    expect((blockEvt.data as { block: { missing: unknown[] } }).block.missing).toHaveLength(1);
    // terminal event must be present
    const terminals = names.filter((n) => n === "done" || n === "error");
    expect(terminals).toHaveLength(1);
  });

  // ── Clarification scenario ────────────────────────────────────────────────

  it("clarification — emits error with CLARIFICATION code", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("error", { code: "CLARIFICATION", message: "Which time period do you mean?" });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "Show me data");

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    expect((errEvt.data as { code: string; message: string }).code).toBe("CLARIFICATION");
    expect((errEvt.data as { code: string; message: string }).message).toBe(
      "Which time period do you mean?",
    );
  });

  it("clarification — no result event emitted", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("error", { code: "CLARIFICATION", message: "Need more context." });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "Sales?");
    const names = events.map((e) => e.event);
    expect(names).not.toContain("result");
    expect(names).not.toContain("block");
  });

  // ── Validation-fail scenario ──────────────────────────────────────────────

  it("validation-fail — emits error with VALIDATION code", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("meta", { messageId: "msg-v1", queryType: "sql" });
      send("error", { code: "VALIDATION", message: "Only SELECT queries are allowed" });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "Drop everything");

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    expect((errEvt.data as { code: string }).code).toBe("VALIDATION");
    const names = events.map((e) => e.event);
    expect(names).not.toContain("result");
  });

  // ── Data-source error scenario ────────────────────────────────────────────

  it("data-source-error — emits error with DATA_SOURCE code", async () => {
    mockPipeline.mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
      send("meta", { messageId: "msg-ds-1", queryType: "sql" });
      send("error", { code: "DATA_SOURCE", message: "Connection refused: unable to reach data source" });
    });

    const app = buildApp(AUTH);
    const { events } = await askSse(app, "conv-1", "Revenue by month");

    const errEvt = events.find((e) => e.event === "error")!;
    expect(errEvt).toBeDefined();
    expect((errEvt.data as { code: string }).code).toBe("DATA_SOURCE");
    const names = events.map((e) => e.event);
    expect(names).not.toContain("result");
  });

  // ── Follow-up (gate re-runs) ──────────────────────────────────────────────

  it("follow-up — gate re-runs on every message (pipeline called each time)", async () => {
    // Both calls succeed independently
    mockPipeline
      .mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
        send("meta", { messageId: "msg-1", queryType: "sql" });
        send("done", { messageId: "msg-1" });
      })
      .mockImplementationOnce(async ({ send }: OrchestratorArgs) => {
        send("meta", { messageId: "msg-2", queryType: "sql" });
        send("done", { messageId: "msg-2" });
      });

    const app = buildApp(AUTH);
    await askSse(app, "conv-1", "First question");
    await askSse(app, "conv-1", "Follow-up question");

    // Pipeline invoked twice — gate was not cached between calls
    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline.mock.calls[0][0].text).toBe("First question");
    expect(mockPipeline.mock.calls[1][0].text).toBe("Follow-up question");
  });

  it("follow-up — second call uses same conversationId", async () => {
    const convIds: string[] = [];
    mockPipeline.mockImplementation(async (args: OrchestratorArgs) => {
      convIds.push(args.conversationId);
      args.send("done", { messageId: "m" });
    });

    const app = buildApp(AUTH);
    await askSse(app, "conv-1", "Q1");
    await askSse(app, "conv-1", "Q2");

    expect(convIds).toEqual(["conv-1", "conv-1"]);
  });

  // ── Pipeline always gets an abort signal ─────────────────────────────────

  it("pipeline receives an AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockPipeline.mockImplementationOnce(async (args: OrchestratorArgs) => {
      capturedSignal = args.signal;
      args.send("done", { messageId: "m1" });
    });

    const app = buildApp(AUTH);
    await askSse(app, "conv-1", "test");

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // Not yet aborted since client didn't disconnect
    expect(capturedSignal!.aborted).toBe(false);
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────

  it("tenant isolation — request for another tenant's conversation returns 404", async () => {
    // Ownership check returns no rows (different tenant's conv not visible)
    const app = buildApp(AUTH, () => []);
    const res = await request(app)
      .post("/api/conversations/other-tenant-conv/messages")
      .send({ text: "Spy on another tenant" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it("tenant isolation — pipeline receives tenantId from auth, not body", async () => {
    let capturedTenantId: string | undefined;
    mockPipeline.mockImplementationOnce(async (args: OrchestratorArgs) => {
      capturedTenantId = args.tenantId;
      args.send("done", { messageId: "m" });
    });

    const app = buildApp(AUTH);
    // Attempt to inject a different tenantId via body (should be ignored)
    await request(app)
      .post("/api/conversations/conv-1/messages")
      .send({ text: "q", tenantId: "evil-tenant" });

    expect(capturedTenantId).toBe("tenant1"); // from auth, not body
  });
});
