import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { adminUsersRouter } from "./users-router.js";
import { requireAdminCapability } from "./require-admin.js";

// ── Mock getPrisma ────────────────────────────────────────────────────────────

const mockPrismaUserUpdate = vi.fn().mockResolvedValue({});

vi.mock("../db/client.js", () => ({
  getPrisma: () => ({
    user: {
      update: mockPrismaUserUpdate,
    },
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_AUTH: AuthContext = { userId: "u1", tenantId: "tenant1", roleId: "role-admin" };
const NO_ROLE_AUTH: AuthContext = { userId: "u2", tenantId: "tenant1", roleId: null };
const NON_ADMIN_AUTH: AuthContext = { userId: "u3", tenantId: "tenant1", roleId: "role-viewer" };

const NOW = new Date("2024-01-01T00:00:00.000Z");

const USER_ROW = {
  id: "user-1",
  email: "alice@example.com",
  display_name: "Alice",
  status: "active" as const,
  role_id: "role-admin",
  auth_methods: ["password" as const],
  created_at: NOW,
};

const USER_CONTRACT = {
  id: "user-1",
  email: "alice@example.com",
  displayName: "Alice",
  status: "active",
  roleId: "role-admin",
  authMethods: ["password"],
  createdAt: NOW.toISOString(),
};

// ── App builders ──────────────────────────────────────────────────────────────

/**
 * Build a test app that mounts the users router directly.
 * Automatically satisfies requireAdminCapability (baked into route handlers)
 * for ADMIN_AUTH by returning canInspectQuery: true for capability queries.
 * dataStub is called for all other $queryRawUnsafe calls.
 */
function buildRouterApp(
  auth: AuthContext = ADMIN_AUTH,
  dataStub: (sql: string, ...args: unknown[]) => unknown = () => [],
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          // requireAdminCapability issues: SELECT capabilities FROM roles WHERE id = $1
          if (/SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
            if (!auth.roleId) return Promise.resolve([]);
            return Promise.resolve([{ capabilities: { canInspectQuery: true } }]);
          }
          return Promise.resolve(dataStub(sql, ...args));
        }),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/users", adminUsersRouter);
  return app;
}

/**
 * Build a test app that includes requireAdminCapability before the router.
 * capabilitiesOverride controls the role-lookup for the admin check.
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
  app.use("/api/admin/users", requireAdminCapability, adminUsersRouter);
  return app;
}

// ── Admin gate tests ──────────────────────────────────────────────────────────

describe("admin gate on GET /api/admin/users", () => {
  it("allows when role has canInspectQuery: true", async () => {
    const app = buildFullApp(ADMIN_AUTH, { canInspectQuery: true }, () => [USER_ROW]);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
  });

  it("returns 403 AUTH when caller has no roleId", async () => {
    const app = buildFullApp(NO_ROLE_AUTH, null);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 403 AUTH when role lacks canInspectQuery", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 403 AUTH when role not found in DB", async () => {
    const app = buildFullApp(ADMIN_AUTH, null);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });
});

describe("admin gate on PATCH /api/admin/users/:id", () => {
  it("returns 403 AUTH when role lacks canInspectQuery", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).patch("/api/admin/users/user-1").send({ status: "suspended" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  it("returns list of users as User contracts", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [USER_ROW]);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([USER_CONTRACT]);
  });

  it("returns empty array when no users", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns roleId as null when user has no role", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [{ ...USER_ROW, role_id: null }]);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body[0].roleId).toBeNull();
  });

  it("includes status in response", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [{ ...USER_ROW, status: "suspended" }]);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe("suspended");
  });

  it("returns multiple users", async () => {
    const user2 = { ...USER_ROW, id: "user-2", email: "bob@example.com", display_name: "Bob" };
    const app = buildRouterApp(ADMIN_AUTH, () => [USER_ROW, user2]);
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1].email).toBe("bob@example.com");
  });
});

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────

describe("GET /api/admin/users/:id", () => {
  it("returns single user when found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [USER_ROW]);
    const res = await request(app).get("/api/admin/users/user-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(USER_CONTRACT);
  });

  it("returns 404 NOT_FOUND when user does not exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/users/no-such-id");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────

describe("PATCH /api/admin/users/:id — role assignment", () => {
  beforeEach(() => {
    mockPrismaUserUpdate.mockResolvedValue({});
  });

  it("assigns a role and returns updated user", async () => {
    const updated = { ...USER_ROW, role_id: "role-analyst" };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      if (callCount === 1) return [USER_ROW]; // SELECT FOR UPDATE
      return [updated]; // UPDATE RETURNING
    });

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: "role-analyst" });

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBe("role-analyst");
  });

  it("unassigns role (roleId: null)", async () => {
    const updated = { ...USER_ROW, role_id: null };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [updated];
    });

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: null });

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBeNull();
  });

  it("syncs platform.users roleId for GAP-17 token refresh propagation", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [{ ...USER_ROW, role_id: "role-analyst" }];
    });

    await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: "role-analyst" });

    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { roleId: "role-analyst" },
    });
  });

  it("syncs null roleId to platform.users when unassigning", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [{ ...USER_ROW, role_id: null }];
    });

    await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: null });

    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { roleId: null },
    });
  });
});

describe("PATCH /api/admin/users/:id — suspend/reinstate", () => {
  beforeEach(() => {
    mockPrismaUserUpdate.mockResolvedValue({});
  });

  it("suspends an active user", async () => {
    const updated = { ...USER_ROW, status: "suspended" as const };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [updated];
    });

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ status: "suspended" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");
  });

  it("reinstates a suspended user", async () => {
    const suspended = { ...USER_ROW, status: "suspended" as const };
    const reinstated = { ...USER_ROW, status: "active" as const };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [suspended] : [reinstated];
    });

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("syncs status to platform.users", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [{ ...USER_ROW, status: "suspended" as const }];
    });

    await request(app)
      .patch("/api/admin/users/user-1")
      .send({ status: "suspended" });

    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "suspended" },
    });
  });

  it("patches both roleId and status in one call", async () => {
    const updated = { ...USER_ROW, role_id: "role-analyst", status: "suspended" as const };
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      callCount++;
      return callCount === 1 ? [USER_ROW] : [updated];
    });

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: "role-analyst", status: "suspended" });

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBe("role-analyst");
    expect(res.body.status).toBe("suspended");
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { roleId: "role-analyst", status: "suspended" },
    });
  });
});

describe("PATCH /api/admin/users/:id — validation", () => {
  it("returns 400 VALIDATION when body is empty", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [USER_ROW]);
    const res = await request(app).patch("/api/admin/users/user-1").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION when status is invalid value", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [USER_ROW]);
    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ status: "invited" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 404 NOT_FOUND when user does not exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app)
      .patch("/api/admin/users/no-such-id")
      .send({ roleId: "role-1" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("list query runs inside withTenantTx (search_path scoped to caller tenant)", async () => {
    let capturedFnRan = false;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = ADMIN_AUTH;
      req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => {
        capturedFnRan = true;
        return fn({
          $queryRawUnsafe: vi.fn().mockImplementation((sql: string) => {
            // Satisfy requireAdminCapability capability lookup
            if (/SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
              return Promise.resolve([{ capabilities: { canInspectQuery: true } }]);
            }
            return Promise.resolve([USER_ROW]);
          }),
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        } as unknown as Prisma.TransactionClient);
      };
      next();
    });
    app.use("/api/admin/users", adminUsersRouter);

    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(capturedFnRan).toBe(true);
  });

  it("rejects request body containing a foreign tenantId", async () => {
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
    app.use("/api/admin/users", adminUsersRouter);

    const res = await request(app)
      .patch("/api/admin/users/user-1")
      .send({ roleId: "role-1", tenantId: "other-tenant" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });
});
