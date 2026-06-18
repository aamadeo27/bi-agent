/**
 * Security-adversarial tests for tenantScopeMiddleware.
 * Covers the testing.md security set: tenant-leakage and foreign-id cases.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { tenantScopeMiddleware } from "./tenant-scope.js";

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
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ l1: { l2: { l3: { tenantId: "tenantB" } } } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks a foreign tenantId inside an array element", async () => {
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ rows: [{ id: 1 }, { id: 2, tenantId: "tenantB" }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks when a matching and a foreign tenantId both appear (defense-in-depth)", async () => {
    // Even if one tenantId is correct, a second foreign one must be rejected.
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ tenantId: "tenantA", nested: { tenantId: "tenantB" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("request scoped to tenant A with tenant B id in body is rejected", async () => {
    // Core tenant-leakage scenario: caller tries to use their valid token to act
    // on another tenant's resources by injecting the target tenantId in the body.
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ query: "SELECT * FROM reports", tenantId: "tenantB" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("blocks foreign tenantId inside deeply nested array of objects", async () => {
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({
        filters: [
          { field: "name", value: "foo" },
          { field: "owner", value: { tenantId: "tenantB" } },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("passes when all tenantId occurrences match the auth tenant", async () => {
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ tenantId: "tenantA", meta: { tenantId: "tenantA" } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("passes a completely tenant-free body for tenant A", async () => {
    const res = await request(buildApp("tenantA"))
      .post("/data")
      .send({ query: "SELECT 1", limit: 100 });
    expect(res.status).toBe(200);
  });
});
