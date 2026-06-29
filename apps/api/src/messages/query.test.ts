/**
 * Unit tests for GET /api/messages/:id/query
 * Covers: allowed role, denied role (no canInspectQuery), tenant isolation,
 * missing message, message without generated query.
 */

import { describe, it, expect, vi } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { messagesRouter } from "./router.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const INSPECT_AUTH: AuthContext = {
  userId: "u-inspect",
  tenantId: "tenantabc",
  roleId: "role-inspector",
};

const NO_ROLE_AUTH: AuthContext = {
  userId: "u-norole",
  tenantId: "tenantabc",
  roleId: null,
};

const DENIED_AUTH: AuthContext = {
  userId: "u-denied",
  tenantId: "tenantabc",
  roleId: "role-viewer",
};

const MSG_ID = "msg-001";
const OTHER_USER_MSG_ID = "msg-002";

const CREATED_AT = new Date("2025-06-01T10:00:00.000Z");

const FULL_MSG_ROW = {
  id: MSG_ID,
  query_type: "sql",
  generated_query: "SELECT * FROM orders",
  result_envelope: { rowCount: 42 },
  data_source_name: "Production DB",
  created_at: CREATED_AT,
};

// ── App builder ────────────────────────────────────────────────────────────────

/**
 * Build the test app, injecting auth + a withTenantTx mock.
 *
 * @param auth          AuthContext to inject
 * @param capabilities  null = role not found; object = returned capabilities
 * @param queryStub     SQL stub called for non-capabilities queries
 */
function buildApp(
  auth: AuthContext,
  capabilities: { canInspectQuery: boolean } | null,
  queryStub: (sql: string, ...args: unknown[]) => unknown = () => [],
): Application {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          // Capability check query
          if (/SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
            if (capabilities === null) return Promise.resolve([]);
            return Promise.resolve([{ capabilities }]);
          }
          return Promise.resolve(queryStub(sql, ...args));
        }),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });

  app.use("/api/messages", messagesRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/messages/:id/query", () => {
  describe("allowed role (canInspectQuery: true)", () => {
    it("returns 200 GeneratedQueryView for a valid message", async () => {
      const app = buildApp(
        INSPECT_AUTH,
        { canInspectQuery: true },
        () => [FULL_MSG_ROW],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        messageId: MSG_ID,
        queryType: "sql",
        queryText: "SELECT * FROM orders",
        dataSourceName: "Production DB",
        executedAt: CREATED_AT.toISOString(),
        rowCount: 42,
      });
    });

    it("returns empty dataSourceName when data source is deleted (null join)", async () => {
      const rowWithoutDs = { ...FULL_MSG_ROW, data_source_name: null };
      const app = buildApp(
        INSPECT_AUTH,
        { canInspectQuery: true },
        () => [rowWithoutDs],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(200);
      expect(res.body.dataSourceName).toBe("");
    });

    it("returns 404 when message does not exist", async () => {
      const app = buildApp(
        INSPECT_AUTH,
        { canInspectQuery: true },
        () => [], // empty = not found
      );

      const res = await request(app).get(`/api/messages/nonexistent/query`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 404 when message has no generated query (user message)", async () => {
      // SQL filters out messages with NULL generated_query — stub returns []
      const app = buildApp(
        INSPECT_AUTH,
        { canInspectQuery: true },
        () => [],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("uses rowCount=0 when result_envelope is null", async () => {
      const rowNoEnvelope = { ...FULL_MSG_ROW, result_envelope: null };
      const app = buildApp(
        INSPECT_AUTH,
        { canInspectQuery: true },
        () => [rowNoEnvelope],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(200);
      expect(res.body.rowCount).toBe(0);
    });
  });

  describe("denied role (canInspectQuery: false)", () => {
    it("returns 403 AUTH when role lacks canInspectQuery", async () => {
      const app = buildApp(
        DENIED_AUTH,
        { canInspectQuery: false },
        () => [FULL_MSG_ROW],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AUTH");
    });

    it("returns 403 AUTH when role row not found", async () => {
      // capabilities=null → DB returns [] for capabilities query
      const app = buildApp(
        DENIED_AUTH,
        null, // role not found
        () => [FULL_MSG_ROW],
      );

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AUTH");
    });
  });

  describe("no role assigned", () => {
    it("returns 403 AUTH when user has no roleId", async () => {
      const app = buildApp(NO_ROLE_AUTH, null);

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("AUTH");
    });
  });

  describe("unauthenticated", () => {
    it("returns 401 AUTH when req.auth is absent", async () => {
      // Build an app without attaching req.auth at all
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        // deliberately do NOT set req.auth
        req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
          fn({
            $queryRawUnsafe: vi.fn().mockResolvedValue([]),
            $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          } as unknown as Prisma.TransactionClient);
        next();
      });
      app.use("/api/messages", messagesRouter);

      const res = await request(app).get(`/api/messages/${MSG_ID}/query`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTH");
    });
  });

  describe("tenant isolation", () => {
    it("returns 404 for a message belonging to another user's conversation", async () => {
      // Simulate: the message exists in the DB but belongs to a different user's
      // conversation. The ownership JOIN (c.user_id = $2) returns no rows.
      const querySpy = vi.fn<(sql: string, ...args: unknown[]) => unknown>().mockReturnValue([]);
      const app = buildApp(INSPECT_AUTH, { canInspectQuery: true }, querySpy);

      const res = await request(app).get(`/api/messages/${OTHER_USER_MSG_ID}/query`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("passes auth.userId as $2 in the ownership JOIN query", async () => {
      // Verify the SQL is actually parameterised with the requesting user's id,
      // not a value from the request path. This ensures the JOIN can't be bypassed.
      const querySpy = vi.fn<(sql: string, ...args: unknown[]) => unknown>().mockReturnValue([]);
      const app = buildApp(INSPECT_AUTH, { canInspectQuery: true }, querySpy);

      await request(app).get(`/api/messages/${MSG_ID}/query`);

      // Find the call that executes the message fetch SQL (FROM messages)
      const msgCall = querySpy.mock.calls.find(
        ([sql]) => typeof sql === "string" && /FROM messages/i.test(sql as string),
      );
      expect(msgCall).toBeDefined();
      // $1 = messageId, $2 = auth.userId — verify ownership param is correct
      expect(msgCall?.[1]).toBe(MSG_ID);
      expect(msgCall?.[2]).toBe(INSPECT_AUTH.userId);
    });

    it("does not leak message details in the 404 response", async () => {
      const app = buildApp(INSPECT_AUTH, { canInspectQuery: true }, () => []);

      const res = await request(app).get(`/api/messages/${OTHER_USER_MSG_ID}/query`);

      expect(res.status).toBe(404);
      // Body must only contain code + message — no query text or user data
      expect(Object.keys(res.body)).toEqual(["code", "message"]);
    });
  });

  describe("validation", () => {
    it("returns 400 VALIDATION for an empty message id", async () => {
      // Express won't match /:id with an empty segment — test with spaces in id
      // We test the schema guard by hitting an invalid route shape.
      // Empty string is not possible as a URL segment; test very-long id instead.
      const longId = "x".repeat(200);
      const app = buildApp(INSPECT_AUTH, { canInspectQuery: true });

      const res = await request(app).get(`/api/messages/${longId}/query`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });
  });
});
