import { describe, it, expect, vi } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { conversationsRouter } from "./router.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_A: AuthContext = { userId: "user-a", tenantId: "tenanta", roleId: "role-1" };
const AUTH_B: AuthContext = { userId: "user-b", tenantId: "tenantb", roleId: "role-2" };

const NOW = new Date("2025-06-01T00:00:00.000Z");

const CONV_ROW = {
  id: "conv-1",
  user_id: "user-a",
  title: "Sales Q1",
  created_at: NOW,
  updated_at: NOW,
};

const MSG_ROW = {
  id: "msg-1",
  conversation_id: "conv-1",
  role: "user",
  content: "Show me sales",
  query_type: null,
  generated_query: null,
  result_envelope: null,
  created_at: NOW,
};

// ---------------------------------------------------------------------------
// App builder — injects auth + a mock withTenantTx
// ---------------------------------------------------------------------------

/**
 * queryStub receives (sql, ...args) and should return the desired row array.
 * All calls to $queryRawUnsafe go through it; use sql-pattern matching for
 * multi-call scenarios (see tenant-isolation helpers below).
 */
function buildApp(
  auth: AuthContext,
  queryStub: (sql: string, ...args: unknown[]) => unknown = () => [],
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

// ---------------------------------------------------------------------------
// GET /api/conversations
// ---------------------------------------------------------------------------

describe("GET /api/conversations", () => {
  it("200 — returns conversation list for authenticated user", async () => {
    const app = buildApp(AUTH_A, () => [CONV_ROW]);
    const res = await request(app).get("/api/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("conv-1");
    expect(res.body[0].title).toBe("Sales Q1");
    expect(res.body[0].updatedAt).toBe(NOW.toISOString());
  });

  it("200 — returns empty array when user has no conversations", async () => {
    const app = buildApp(AUTH_A, () => []);
    const res = await request(app).get("/api/conversations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("tenant scoping — userId from auth is passed to query (not body/params)", async () => {
    let capturedArgs: unknown[] = [];
    const app = buildApp(AUTH_A, (_sql, ...args) => {
      capturedArgs = args;
      return [];
    });
    await request(app).get("/api/conversations");
    // First positional arg must be AUTH_A.userId
    expect(capturedArgs[0]).toBe("user-a");
  });

  it("tenant isolation — tenant B query uses tenant B userId, not tenant A's", async () => {
    let capturedUserId: unknown;
    const appA = buildApp(AUTH_A, (_sql, userId) => { capturedUserId = userId; return []; });
    const appB = buildApp(AUTH_B, (_sql, userId) => { capturedUserId = userId; return []; });

    await request(appA).get("/api/conversations");
    expect(capturedUserId).toBe("user-a");

    await request(appB).get("/api/conversations");
    expect(capturedUserId).toBe("user-b");
  });
});

// ---------------------------------------------------------------------------
// POST /api/conversations
// ---------------------------------------------------------------------------

describe("POST /api/conversations", () => {
  it("201 — creates a conversation and returns summary", async () => {
    const created = { ...CONV_ROW, title: "" };
    const app = buildApp(AUTH_A, () => [created]);
    const res = await request(app).post("/api/conversations").send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("tenant scoping — INSERT passes userId from auth token", async () => {
    let capturedArgs: unknown[] = [];
    const app = buildApp(AUTH_A, (_sql, ...args) => {
      capturedArgs = args;
      return [{ ...CONV_ROW, id: capturedArgs[0], user_id: capturedArgs[1], title: "" }];
    });
    await request(app).post("/api/conversations").send({});
    // Second arg to INSERT = userId
    expect(capturedArgs[1]).toBe("user-a");
  });

  it("500 — returns INTERNAL when DB throws", async () => {
    const app = buildApp(AUTH_A, () => { throw new Error("DB down"); });
    const res = await request(app).post("/api/conversations").send({});
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// GET /api/conversations/:id/messages
// ---------------------------------------------------------------------------

describe("GET /api/conversations/:id/messages", () => {
  /**
   * This route makes two raw queries: first getConversation (ownership check),
   * then messages SELECT. Return the appropriate rows based on sql content.
   */
  function multiQueryStub(ownedConvRow: typeof CONV_ROW | null, msgRows: typeof MSG_ROW[]) {
    return (sql: string) => {
      if (/FROM conversations\s+WHERE/.test(sql)) return ownedConvRow ? [ownedConvRow] : [];
      if (/FROM messages/.test(sql)) return msgRows;
      return [];
    };
  }

  it("200 — returns messages for an owned conversation", async () => {
    const app = buildApp(AUTH_A, multiQueryStub(CONV_ROW, [MSG_ROW]));
    const res = await request(app).get("/api/conversations/conv-1/messages");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("msg-1");
    expect(res.body[0].role).toBe("user");
    expect(res.body[0].content).toBe("Show me sales");
    expect(res.body[0].createdAt).toBe(NOW.toISOString());
  });

  it("200 — returns empty array when conversation has no messages", async () => {
    const app = buildApp(AUTH_A, multiQueryStub(CONV_ROW, []));
    const res = await request(app).get("/api/conversations/conv-1/messages");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("404 NOT_FOUND — conversation not found for this user", async () => {
    const app = buildApp(AUTH_A, multiQueryStub(null, []));
    const res = await request(app).get("/api/conversations/conv-999/messages");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("tenant isolation — user B cannot read user A's conversation (ownership check uses userId)", async () => {
    // AUTH_B attempts to fetch a conversation owned by user-a; ownership check passes userId
    let checkedUserId: unknown;
    const app = buildApp(AUTH_B, (sql, _convId, userId) => {
      if (/FROM conversations\s+WHERE/.test(sql)) {
        checkedUserId = userId;
        // Simulate row not found because user_id doesn't match
        return [];
      }
      return [];
    });
    const res = await request(app).get("/api/conversations/conv-1/messages");
    expect(res.status).toBe(404);
    // Ownership check used tenant B's userId
    expect(checkedUserId).toBe("user-b");
  });

  it("400 VALIDATION — rejects empty id param", async () => {
    // Express won't route '' as /:id — test a minimal (but structurally valid) path
    // instead test the schema boundary: id longer than 128 chars
    const longId = "x".repeat(129);
    const app = buildApp(AUTH_A, () => []);
    const res = await request(app).get(`/api/conversations/${longId}/messages`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("includes resultEnvelope, queryType, generatedQuery in message response", async () => {
    const envelope = {
      messageId: "msg-2",
      queryType: "sql",
      chartType: "bar",
      columns: [],
      rows: [],
      rowCount: 5,
      truncated: false,
    };
    const assistantMsg = {
      ...MSG_ROW,
      id: "msg-2",
      role: "assistant" as const,
      query_type: "sql" as string | null,
      generated_query: "SELECT 1" as string | null,
      result_envelope: envelope as unknown,
    };
    const app = buildApp(AUTH_A, multiQueryStub(CONV_ROW, [assistantMsg]));
    const res = await request(app).get("/api/conversations/conv-1/messages");
    expect(res.status).toBe(200);
    expect(res.body[0].queryType).toBe("sql");
    expect(res.body[0].generatedQuery).toBe("SELECT 1");
    expect(res.body[0].resultEnvelope).toMatchObject({ rowCount: 5 });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/conversations/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/conversations/:id", () => {
  it("204 — deletes an owned conversation", async () => {
    const app = buildApp(AUTH_A, () => [{ id: "conv-1" }]);
    const res = await request(app).delete("/api/conversations/conv-1");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("404 NOT_FOUND — conversation not found or not owned by this user", async () => {
    const app = buildApp(AUTH_A, () => []);
    const res = await request(app).delete("/api/conversations/conv-999");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("tenant isolation — DELETE passes userId from auth (not request body)", async () => {
    let capturedArgs: unknown[] = [];
    const app = buildApp(AUTH_A, (_sql, ...args) => {
      capturedArgs = args;
      return [{ id: capturedArgs[0] }];
    });
    await request(app).delete("/api/conversations/conv-1");
    // Second arg must be AUTH_A.userId
    expect(capturedArgs[1]).toBe("user-a");
  });

  it("tenant isolation — user B delete attempt uses user B's userId in WHERE clause", async () => {
    let checkedUserId: unknown;
    const app = buildApp(AUTH_B, (_sql, _convId, userId) => {
      checkedUserId = userId;
      return []; // simulate not found for user-b
    });
    const res = await request(app).delete("/api/conversations/conv-1");
    expect(res.status).toBe(404);
    expect(checkedUserId).toBe("user-b");
  });

  it("400 VALIDATION — rejects id longer than 128 chars", async () => {
    const longId = "y".repeat(129);
    const app = buildApp(AUTH_A, () => []);
    const res = await request(app).delete(`/api/conversations/${longId}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("500 INTERNAL — returns error code when DB throws", async () => {
    const app = buildApp(AUTH_A, () => { throw new Error("connection reset"); });
    const res = await request(app).delete("/api/conversations/conv-1");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL");
  });
});
