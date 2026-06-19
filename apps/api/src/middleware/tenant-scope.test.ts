import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { tenantScopeMiddleware, collectTenantIds } from "./tenant-scope.js";
import type { AuthContext } from "./auth.js";

// Prevent withTenant from touching a real DB — it is only stored in a closure,
// but the mock ensures no accidental connection attempt if a test calls it.
vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

/** Build a test app with req.auth pre-populated as if authMiddleware ran. */
function buildApp(tenantId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: "user1", tenantId, roleId: null } satisfies AuthContext;
    next();
  });
  app.post("/data", tenantScopeMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ─── tenantScopeMiddleware ───────────────────────────────────────────────────

describe("tenantScopeMiddleware", () => {
  it("passes a request with no tenantId in the body", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ name: "report" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("passes when body tenantId matches the auth context", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ tenantId: "tenant01", name: "report" });
    expect(res.status).toBe(200);
  });

  it("rejects 403 TENANT when body contains a foreign tenantId", async () => {
    const res = await request(buildApp("tenant01"))
      .post("/data")
      .send({ tenantId: "tenant02" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("rejects 403 TENANT when req.auth.tenantId has invalid format", async () => {
    // A malformed tenantId in the JWT (e.g. contains hyphens) must be rejected.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: "u1", tenantId: "bad-tenant-id!", roleId: null };
      next();
    });
    app.post("/data", tenantScopeMiddleware, (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).post("/data").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("returns 401 AUTH when req.auth is absent (auth middleware skipped)", async () => {
    const app = express();
    app.use(express.json());
    app.post("/data", tenantScopeMiddleware, (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).post("/data").send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("attaches withTenantTx as a function to the request", async () => {
    const captured: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: "u1", tenantId: "tenant01", roleId: null };
      next();
    });
    app.post("/data", tenantScopeMiddleware, (req, res) => {
      captured.push(typeof req.withTenantTx);
      res.json({ ok: true });
    });

    await request(app).post("/data").send({});
    expect(captured[0]).toBe("function");
  });

  it("does not call next() when a foreign tenantId is present", async () => {
    const captured: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: "u1", tenantId: "tenant01", roleId: null };
      next();
    });
    app.post("/data", tenantScopeMiddleware, (_req, res) => {
      captured.push(true);
      res.json(null);
    });
    await request(app).post("/data").send({ tenantId: "tenant02" });
    expect(captured).toHaveLength(0);
  });
});

// ─── collectTenantIds ────────────────────────────────────────────────────────

describe("collectTenantIds", () => {
  it("returns [] for null", () => {
    expect(collectTenantIds(null)).toEqual([]);
  });

  it("returns [] for primitive values", () => {
    expect(collectTenantIds("string")).toEqual([]);
    expect(collectTenantIds(42)).toEqual([]);
    expect(collectTenantIds(true)).toEqual([]);
  });

  it("returns [] for an empty object", () => {
    expect(collectTenantIds({})).toEqual([]);
  });

  it("extracts a top-level string tenantId", () => {
    expect(collectTenantIds({ tenantId: "t1" })).toEqual(["t1"]);
  });

  it("extracts tenantId from a nested object", () => {
    expect(collectTenantIds({ a: { tenantId: "t2" } })).toEqual(["t2"]);
  });

  it("extracts tenantId from array elements", () => {
    expect(
      collectTenantIds({ items: [{ tenantId: "t3" }, { tenantId: "t4" }] })
    ).toEqual(["t3", "t4"]);
  });

  it("ignores non-string tenantId values", () => {
    expect(collectTenantIds({ tenantId: 123 })).toEqual([]);
    expect(collectTenantIds({ tenantId: null })).toEqual([]);
    expect(collectTenantIds({ tenantId: { nested: "val" } })).toEqual([]);
  });

  it("collects multiple tenantIds from the same object", () => {
    const ids = collectTenantIds({
      tenantId: "t1",
      sub: { tenantId: "t2" },
    });
    expect(ids).toEqual(["t1", "t2"]);
  });

  it("returns [] when nesting exceeds MAX_DEPTH (20 levels)", () => {
    // Build a chain deeper than MAX_DEPTH; the tenantId at the bottom must be ignored.
    let nested: unknown = { tenantId: "hidden" };
    for (let i = 0; i < 22; i++) {
      nested = { child: nested };
    }
    expect(collectTenantIds(nested)).toEqual([]);
  });

  it("still extracts tenantId just within MAX_DEPTH", () => {
    // At depth 19 (0-indexed), the value should still be collected.
    let nested: unknown = { tenantId: "visible" };
    for (let i = 0; i < 18; i++) {
      nested = { child: nested };
    }
    expect(collectTenantIds(nested)).toEqual(["visible"]);
  });
});
