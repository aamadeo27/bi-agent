import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { meRouter } from "./index.js";
import type { AuthContext } from "../middleware/auth.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("argon2", () => ({
  hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verify: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/client.js", () => ({
  getPrisma: vi.fn(() => ({
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: "tenant1",
        displayName: "Acme Corp",
        status: "active",
        slug: "acme",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(
  auth: AuthContext,
  withTenantTxImpl: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
) {
  const app = express();
  app.use(express.json());

  // Inject auth + withTenantTx as middleware (simulates authMiddleware + tenantScopeMiddleware)
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = withTenantTxImpl as NonNullable<typeof req.withTenantTx>;
    next();
  });

  app.use("/me", meRouter);
  return app;
}

const defaultAuth: AuthContext = {
  userId: "user1",
  tenantId: "tenant1",
  roleId: "role1",
};

// Default DB stub: user with password auth + an assigned role
function makeUserRow(overrides: Partial<{
  id: string;
  email: string;
  display_name: string;
  status: string;
  role_id: string | null;
  auth_methods: string;
}> = {}) {
  return {
    id: "user1",
    email: "alice@example.com",
    display_name: "Alice",
    status: "active",
    role_id: "role1",
    auth_methods: '["password"]',
    ...overrides,
  };
}

function makeRoleRow(overrides: Partial<{
  id: string;
  name: string;
  capabilities: string;
}> = {}) {
  return {
    id: "role1",
    name: "Analyst",
    capabilities: '{"canInspectQuery":false}',
    ...overrides,
  };
}

// Builds a withTenantTx that handles sequential calls
function makeWithTenantTx(
  userRows: unknown[],
  roleRows: unknown[] = [],
  extraHandlers: Array<(sql: string, ...args: unknown[]) => unknown> = [],
) {
  let callCount = 0;
  return async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
        if (sql.includes("SELECT") && sql.includes("display_name")) return userRows;
        if (sql.includes("SELECT") && sql.includes("capabilities")) return roleRows;
        if (sql.includes("SELECT") && sql.includes("password_hash")) return userRows;
        // fallback
        if (extraHandlers[callCount]) return extraHandlers[callCount++](sql, ...args);
        return [];
      }),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    return fn(tx);
  };
}

// ─── GET /me ─────────────────────────────────────────────────────────────────

describe("GET /me", () => {
  it("returns 200 with full MeResponse when user and role exist", async () => {
    const withTenantTx = makeWithTenantTx([makeUserRow()], [makeRoleRow()]);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(res.body.user.displayName).toBe("Alice");
    expect(res.body.user.authMethods).toEqual(["password"]);
    expect(res.body.role).toEqual({ id: "role1", name: "Analyst" });
    expect(res.body.capabilities).toEqual({ canInspectQuery: false, isAdmin: false });
    expect(res.body.tenant).toEqual({ id: "tenant1", displayName: "Acme Corp" });
  });

  it("returns role null and default capabilities when user has no role", async () => {
    const withTenantTx = makeWithTenantTx([makeUserRow({ role_id: null })], []);
    const app = buildApp({ ...defaultAuth, roleId: null }, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(200);
    expect(res.body.role).toBeNull();
    expect(res.body.capabilities).toEqual({ canInspectQuery: false, isAdmin: false });
  });

  it("returns canInspectQuery: true when role has the capability", async () => {
    const withTenantTx = makeWithTenantTx(
      [makeUserRow()],
      [makeRoleRow({ capabilities: '{"canInspectQuery":true}' })],
    );
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(200);
    expect(res.body.capabilities.canInspectQuery).toBe(true);
  });

  it("returns 404 when user not found in tenant schema", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 403 TENANT when tenant not found in platform", async () => {
    const { getPrisma } = await import("../db/client.js");
    vi.mocked(getPrisma).mockReturnValueOnce({
      tenant: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as ReturnType<typeof getPrisma>);

    const withTenantTx = makeWithTenantTx([makeUserRow()], [makeRoleRow()]);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });

  it("returns sso authMethods correctly", async () => {
    const withTenantTx = makeWithTenantTx(
      [makeUserRow({ auth_methods: '["sso"]' })],
      [makeRoleRow()],
    );
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).get("/me");
    expect(res.status).toBe(200);
    expect(res.body.user.authMethods).toEqual(["sso"]);
  });
});

// ─── PATCH /me ───────────────────────────────────────────────────────────────

describe("PATCH /me", () => {
  it("returns 204 on valid display name update", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).patch("/me").send({ displayName: "Alice B." });
    expect(res.status).toBe(204);
  });

  it("returns 400 VALIDATION on empty displayName", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).patch("/me").send({ displayName: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION on displayName > 256 chars", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).patch("/me").send({ displayName: "A".repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION on missing displayName", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).patch("/me").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});

// ─── POST /me/password ────────────────────────────────────────────────────────

describe("POST /me/password", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // vi.mock() is only hoisted when called at the top level of the module.
    // Inside beforeEach it has no effect. Reconfigure the already-hoisted mocks
    // using vi.mocked() instead.
    const { getPrisma } = await import("../db/client.js");
    vi.mocked(getPrisma).mockImplementation(
      () =>
        ({
          tenant: {
            findUnique: vi.fn().mockResolvedValue({
              id: "tenant1",
              displayName: "Acme Corp",
              slug: "acme",
              status: "active",
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
        }) as unknown as ReturnType<typeof getPrisma>,
    );

    const { hash, verify } = await import("argon2");
    vi.mocked(hash).mockResolvedValue("$argon2id$newhash" as never);
    vi.mocked(verify).mockResolvedValue(true as never);
  });

  it("returns 204 on valid password change", async () => {
    const { verify } = await import("argon2");
    vi.mocked(verify).mockResolvedValue(true);

    const withTenantTx = makeWithTenantTx(
      [{ password_hash: "$argon2id$oldhash", auth_methods: '["password"]' }],
      [],
    );
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app)
      .post("/me/password")
      .send({ currentPassword: "OldPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(204);
  });

  it("returns 401 AUTH when current password is wrong", async () => {
    const { verify } = await import("argon2");
    vi.mocked(verify).mockResolvedValue(false);

    const withTenantTx = makeWithTenantTx(
      [{ password_hash: "$argon2id$oldhash", auth_methods: '["password"]' }],
      [],
    );
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app)
      .post("/me/password")
      .send({ currentPassword: "WrongPass!", newPassword: "NewPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 400 VALIDATION when user has no password auth", async () => {
    const withTenantTx = makeWithTenantTx(
      [{ password_hash: null, auth_methods: '["sso"]' }],
      [],
    );
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app)
      .post("/me/password")
      .send({ currentPassword: "OldPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION when newPassword is too short", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app)
      .post("/me/password")
      .send({ currentPassword: "OldPass1!", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 404 NOT_FOUND when user not found", async () => {
    const withTenantTx = makeWithTenantTx([], []);
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app)
      .post("/me/password")
      .send({ currentPassword: "OldPass1!", newPassword: "NewPass1!" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ─── POST /me/logout-all ──────────────────────────────────────────────────────

describe("POST /me/logout-all", () => {
  it("returns 204 and sets token_invalidated_at = NOW()", async () => {
    const executedSqls: string[] = [];
    const withTenantTx = async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        $executeRawUnsafe: vi.fn(async (sql: string) => {
          executedSqls.push(sql);
          return 1;
        }),
      };
      return fn(tx);
    };
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).post("/me/logout-all");
    expect(res.status).toBe(204);

    // ALTER TABLE guard must run first (inline migration for existing tenants)
    expect(executedSqls[0]).toMatch(/ALTER TABLE.*ADD COLUMN IF NOT EXISTS.*token_invalidated_at/i);
    // UPDATE must set token_invalidated_at to NOW()
    expect(executedSqls[1]).toMatch(/UPDATE users SET token_invalidated_at = NOW\(\)/i);
  });

  it("returns 500 INTERNAL when the DB update fails", async () => {
    const withTenantTx = async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        $executeRawUnsafe: vi.fn().mockRejectedValue(new Error("Simulated DB error")),
      };
      return fn(tx);
    };
    const app = buildApp(defaultAuth, withTenantTx);

    const res = await request(app).post("/me/logout-all");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL");
  });
});
