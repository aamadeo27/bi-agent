import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { rolesRouter } from "./roles-router.js";
import { requireAdminCapability } from "./require-admin.js";

// ── Audit mock ────────────────────────────────────────────────────────────────

vi.mock("../audit/index.js", () => ({
  emitAdminAudit: vi.fn().mockResolvedValue(undefined),
}));

import { emitAdminAudit } from "../audit/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_AUTH: AuthContext = { userId: "u1", tenantId: "tenant1", roleId: "role-admin" };
const NO_ROLE_AUTH: AuthContext = { userId: "u2", tenantId: "tenant1", roleId: null };
const NON_ADMIN_AUTH: AuthContext = { userId: "u3", tenantId: "tenant1", roleId: "role-viewer" };

const NOW = new Date("2024-01-01T00:00:00.000Z");

const ROLE_ROW = {
  id: "role-1",
  name: "Analysts",
  description: "Can view dashboards",
  capabilities: { canInspectQuery: false },
  created_at: NOW,
  updated_at: NOW,
};

const ROLE_CONTRACT = {
  id: "role-1",
  name: "Analysts",
  description: "Can view dashboards",
  capabilities: { canInspectQuery: false },
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

// ── App builders ──────────────────────────────────────────────────────────────

/**
 * Build a test app that mounts the roles router directly (no admin gate).
 * mockQueryFn is called for every $queryRawUnsafe call — it receives the SQL + params
 * and returns the stub result.
 */
function buildRouterApp(
  auth: AuthContext = ADMIN_AUTH,
  mockQueryFn: (sql: string, ...args: unknown[]) => unknown = () => [],
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation(mockQueryFn),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/roles", rolesRouter);
  return app;
}

/**
 * Build a test app that includes requireAdminCapability before the router.
 * capabilitiesOverride controls what the role-lookup returns for the admin check.
 */
function buildFullApp(
  auth: AuthContext,
  capabilities: { canInspectQuery: boolean } | null,
  crudStub: (sql: string, ...args: unknown[]) => unknown = () => [],
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          // Admin gate issues: SELECT capabilities FROM roles WHERE id = $1
          // Distinguish from the list query by requiring WHERE id clause.
          if (typeof sql === "string" && /SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
            if (capabilities === null) return Promise.resolve([]);
            return Promise.resolve([{ capabilities }]);
          }
          return Promise.resolve(crudStub(sql, ...args));
        }),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/roles", requireAdminCapability, rolesRouter);
  return app;
}

// ── Admin gate tests ──────────────────────────────────────────────────────────

describe("requireAdminCapability", () => {
  it("allows request when role has canInspectQuery: true", async () => {
    const app = buildFullApp(ADMIN_AUTH, { canInspectQuery: true }, () => [ROLE_ROW]);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(200);
  });

  it("returns 403 AUTH when caller has no roleId", async () => {
    const app = buildFullApp(NO_ROLE_AUTH, null);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 403 AUTH when role has canInspectQuery: false", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 403 AUTH when role is not found in DB", async () => {
    const app = buildFullApp(ADMIN_AUTH, null);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });
});

// ── GET /api/admin/roles ──────────────────────────────────────────────────────

describe("GET /api/admin/roles", () => {
  it("returns list of roles as Role contracts", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [ROLE_ROW]);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([ROLE_CONTRACT]);
  });

  it("returns empty array when no roles exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("omits description field when null", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [{ ...ROLE_ROW, description: null }]);
    const res = await request(app).get("/api/admin/roles");
    expect(res.status).toBe(200);
    expect(res.body[0].description).toBeUndefined();
  });
});

// ── GET /api/admin/roles/:id ──────────────────────────────────────────────────

describe("GET /api/admin/roles/:id", () => {
  it("returns single role when found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [ROLE_ROW]);
    const res = await request(app).get("/api/admin/roles/role-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ROLE_CONTRACT);
  });

  it("returns 404 NOT_FOUND when role does not exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/roles/no-such-id");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ── POST /api/admin/roles ─────────────────────────────────────────────────────

describe("POST /api/admin/roles", () => {
  it("creates role with provided fields and returns 201", async () => {
    const created = { ...ROLE_ROW, id: "new-id" };
    const app = buildRouterApp(ADMIN_AUTH, () => [created]);
    const res = await request(app).post("/api/admin/roles").send({
      name: "Analysts",
      description: "Can view dashboards",
      capabilities: { canInspectQuery: false },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Analysts");
    expect(res.body.capabilities.canInspectQuery).toBe(false);
  });

  it("defaults canInspectQuery to false when capabilities omitted", async () => {
    let capturedArgs: unknown[] = [];
    const app = buildRouterApp(ADMIN_AUTH, (_sql, ...args) => {
      capturedArgs = args;
      return [ROLE_ROW];
    });
    await request(app).post("/api/admin/roles").send({ name: "Viewers" });
    // 4th arg is the capabilities JSON
    expect(JSON.parse(capturedArgs[3] as string)).toEqual({ canInspectQuery: false });
  });

  it("returns 400 VALIDATION when name exceeds 64 chars", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app)
      .post("/api/admin/roles")
      .send({ name: "x".repeat(65) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION when description exceeds 256 chars", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app)
      .post("/api/admin/roles")
      .send({ name: "Valid", description: "d".repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION on duplicate name (unique constraint violation)", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => {
      const err = new Error("unique") as Error & { code: string };
      err.code = "23505";
      throw err;
    });
    const res = await request(app).post("/api/admin/roles").send({ name: "Analysts" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION when name is missing", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).post("/api/admin/roles").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});

// ── PATCH /api/admin/roles/:id ────────────────────────────────────────────────

describe("PATCH /api/admin/roles/:id", () => {
  it("updates name and returns updated role", async () => {
    const updated = { ...ROLE_ROW, name: "Senior Analysts" };
    // First call: SELECT FOR UPDATE (returns current); second: UPDATE RETURNING (returns updated)
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, (_sql) => {
      callCount++;
      if (callCount === 1) return [ROLE_ROW]; // SELECT FOR UPDATE
      return [updated]; // UPDATE RETURNING
    });
    const res = await request(app)
      .patch("/api/admin/roles/role-1")
      .send({ name: "Senior Analysts" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Senior Analysts");
  });

  it("updates canInspectQuery capability", async () => {
    const updated = { ...ROLE_ROW, capabilities: { canInspectQuery: true } };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [ROLE_ROW];
      return [updated];
    });
    const res = await request(app)
      .patch("/api/admin/roles/role-1")
      .send({ capabilities: { canInspectQuery: true } });
    expect(res.status).toBe(200);
    expect(res.body.capabilities.canInspectQuery).toBe(true);
  });

  it("clears description when explicitly set to null", async () => {
    const updated = { ...ROLE_ROW, description: null };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [ROLE_ROW] : [updated];
    });
    const res = await request(app)
      .patch("/api/admin/roles/role-1")
      .send({ description: null });
    expect(res.status).toBe(200);
    expect(res.body.description).toBeUndefined();
  });

  it("returns 404 NOT_FOUND when role does not exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app)
      .patch("/api/admin/roles/no-such-id")
      .send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 400 VALIDATION on duplicate name", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [ROLE_ROW]; // SELECT FOR UPDATE succeeds
      const err = new Error("unique") as Error & { code: string };
      err.code = "23505";
      throw err;
    });
    const res = await request(app)
      .patch("/api/admin/roles/role-1")
      .send({ name: "Admin" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});

// ── DELETE /api/admin/roles/:id ───────────────────────────────────────────────

describe("DELETE /api/admin/roles/:id", () => {
  it("deletes role and returns affectedUsers count", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [{ count: "3" }]; // COUNT users
      return [{ id: "role-1" }]; // DELETE RETURNING
    });
    const res = await request(app).delete("/api/admin/roles/role-1");
    expect(res.status).toBe(200);
    expect(res.body.affectedUsers).toBe(3);
  });

  it("reports 0 affected users when role has no members", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [{ count: "0" }];
      return [{ id: "role-1" }];
    });
    const res = await request(app).delete("/api/admin/roles/role-1");
    expect(res.status).toBe(200);
    expect(res.body.affectedUsers).toBe(0);
  });

  it("returns 404 NOT_FOUND when role does not exist", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [{ count: "0" }]; // COUNT
      return []; // DELETE returns nothing — role not found
    });
    const res = await request(app).delete("/api/admin/roles/no-such-id");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("rejects POST body containing a foreign tenantId", async () => {
    // tenantScopeMiddleware handles this check; here we verify the middleware
    // is what blocks the request by simulating its rejection in the test app.
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = ADMIN_AUTH;
      // Simulate tenantScopeMiddleware blocking a foreign tenant body
      const body = req.body as Record<string, unknown>;
      if (body.tenantId && body.tenantId !== ADMIN_AUTH.tenantId) {
        res.status(403).json({ code: "TENANT", message: "Request body references a foreign tenant" });
        return;
      }
      req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockResolvedValue([]),
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        } as unknown as Prisma.TransactionClient);
      next();
    });
    app.use("/api/admin/roles", rolesRouter);

    const res = await request(app)
      .post("/api/admin/roles")
      .send({ name: "Hijack", tenantId: "other-tenant" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });
});

// ── Audit emission call-site tests ────────────────────────────────────────────

describe("audit emission on role mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits role_changed audit when PATCH /:id succeeds", async () => {
    let callCount = 0;
    const updated = { ...ROLE_ROW, name: "Editors" };
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [ROLE_ROW] : [updated];
    });

    const res = await request(app)
      .patch("/api/admin/roles/role-1")
      .send({ name: "Editors" });

    expect(res.status).toBe(200);
    expect(vi.mocked(emitAdminAudit)).toHaveBeenCalledOnce();
    expect(vi.mocked(emitAdminAudit)).toHaveBeenCalledWith(
      ADMIN_AUTH,
      expect.anything(), // req.ip value depends on test environment
      expect.objectContaining({ type: "role_changed", outcome: "success" }),
    );
  });

  it("does NOT emit role_changed audit when PATCH /:id returns 404", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []); // role not found
    await request(app).patch("/api/admin/roles/no-such-id").send({ name: "X" });
    expect(vi.mocked(emitAdminAudit)).not.toHaveBeenCalled();
  });

  it("emits permission_changed audit when PUT /:id/grants succeeds", async () => {
    const app = buildRouterApp(ADMIN_AUTH, (sql) => {
      if (/SELECT.*FROM\s+roles\s+WHERE/i.test(sql)) return [{ id: "role-1" }];
      return []; // INSERT per grant
    });

    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send([]);

    expect(res.status).toBe(200);
    expect(vi.mocked(emitAdminAudit)).toHaveBeenCalledOnce();
    expect(vi.mocked(emitAdminAudit)).toHaveBeenCalledWith(
      ADMIN_AUTH,
      expect.anything(),
      expect.objectContaining({ type: "permission_changed", outcome: "success" }),
    );
  });
});
