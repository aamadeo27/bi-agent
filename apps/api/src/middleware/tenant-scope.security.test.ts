/**
 * Security-adversarial tests for tenantScopeMiddleware.
 * Covers the testing.md security set: tenant-leakage, foreign-id, and
 * crafted-payload (extreme depth) cases.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { tenantScopeMiddleware } from "./tenant-scope.js";

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

function buildApp(tenantId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: "user1", tenantId, roleId: null };
    next();
  });
  app.post("/data", tenantScopeMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("tenantScopeMiddleware — tenant leakage / foreign-id (security)", () => {
  it("blocks a foreign tenantId three levels deep", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ l1: { l2: { l3: { tenantId: "tenant02" } } } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks a foreign tenantId inside an array element", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ rows: [{ id: 1 }, { id: 2, tenantId: "tenant02" }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks when a matching and a foreign tenantId both appear (defense-in-depth)", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ tenantId: "tenant01", nested: { tenantId: "tenant02" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("request scoped to tenant A with tenant B id in body is rejected", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ query: "SELECT * FROM reports", tenantId: "tenant02" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks foreign tenantId inside deeply nested array of objects", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({
        filters: [
          { field: "name", value: "foo" },
          { field: "owner", value: { tenantId: "tenant02" } },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("passes when all tenantId occurrences match the auth tenant", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ tenantId: "tenant01", meta: { tenantId: "tenant01" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("passes a completely tenant-free body", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ query: "SELECT 1", limit: 100 });
    expect(res.status).toBe(200);
  });

  it("does not exhaust the call stack on a 500-levels-deep crafted payload", async () => {
    // Attacker sends a deeply-nested object hoping to crash via stack overflow.
    let payload: unknown = { tenantId: "tenant02" };
    for (let i = 0; i < 500; i++) {
      payload = { child: payload };
    }
    // Must return 200 (tenantId truncated by depth limit — not found) or 403 (if
    // found within MAX_DEPTH). Either way, the process must NOT crash.
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send(payload as object);
    expect([200, 403]).toContain(res.status);
  });
});
