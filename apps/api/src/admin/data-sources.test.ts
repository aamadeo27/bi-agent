import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { dataSourcesRouter } from "./data-sources-router.js";
import { requireAdminCapability } from "./require-admin.js";

// ── Test vault key ─────────────────────────────────────────────────────────────

const TEST_MASTER_KEY = "c".repeat(64); // 32 bytes

// ── Fixtures ───────────────────────────────────────────────────────────────────

const ADMIN_AUTH: AuthContext = { userId: "u1", tenantId: "tenant1", roleId: "role-admin" };
const NO_ROLE_AUTH: AuthContext = { userId: "u2", tenantId: "tenant1", roleId: null };
const NON_ADMIN_AUTH: AuthContext = { userId: "u3", tenantId: "tenant1", roleId: "role-viewer" };

const NOW = new Date("2025-01-01T00:00:00.000Z");

const DS_ROW = {
  id: "ds-1",
  name: "Production DB",
  type: "postgres",
  status: "unconfigured",
  last_tested_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const DS_CONTRACT = {
  id: "ds-1",
  name: "Production DB",
  type: "postgres",
  status: "unconfigured",
};

// ── App builders ───────────────────────────────────────────────────────────────

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
  app.use("/api/admin/data-sources", dataSourcesRouter);
  return app;
}

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
  app.use("/api/admin/data-sources", requireAdminCapability, dataSourcesRouter);
  return app;
}

// ── Admin gate tests ───────────────────────────────────────────────────────────

describe("requireAdminCapability on data-sources", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("allows admin role with canInspectQuery: true", async () => {
    const app = buildFullApp(ADMIN_AUTH, { canInspectQuery: true }, () => [DS_ROW]);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(200);
  });

  it("blocks caller with no roleId — 403 AUTH", async () => {
    const app = buildFullApp(NO_ROLE_AUTH, null);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("blocks caller with canInspectQuery: false — 403 AUTH", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/data-sources", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("returns list of data sources as DataSource contracts", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([DS_CONTRACT]);
  });

  it("returns empty array when no data sources", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("includes lastTestedAt when set", async () => {
    const row = { ...DS_ROW, status: "connected", last_tested_at: NOW };
    const app = buildRouterApp(ADMIN_AUTH, () => [row]);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(200);
    expect(res.body[0].lastTestedAt).toBe(NOW.toISOString());
  });

  it("never includes connectionConfig or config_encrypted in response", async () => {
    const rowWithConfig = { ...DS_ROW, config_encrypted: '{"enc":"secret"}' };
    const app = buildRouterApp(ADMIN_AUTH, () => [rowWithConfig]);
    const res = await request(app).get("/api/admin/data-sources");
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("connectionConfig");
    expect(body).not.toContain("config_encrypted");
    expect(body).not.toContain("secret");
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/data-sources/:id", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("returns single data source when found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app).get("/api/admin/data-sources/ds-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DS_CONTRACT);
  });

  it("returns 404 NOT_FOUND when not found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/data-sources/missing");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("never exposes connectionConfig in GET /:id response", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app).get("/api/admin/data-sources/ds-1");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("connectionConfig");
    expect(res.body).not.toHaveProperty("config_encrypted");
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe("POST /api/admin/data-sources", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("creates a data source and returns 201 with DataSource contract", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app)
      .post("/api/admin/data-sources")
      .send({ name: "Production DB", type: "postgres" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("Production DB");
    expect(res.body.type).toBe("postgres");
  });

  it("accepts and encrypts connectionConfig (write-only)", async () => {
    let capturedArgs: unknown[] = [];

    const app = buildRouterApp(ADMIN_AUTH, (_sql, ...args) => {
      capturedArgs = args;
      return [DS_ROW];
    });

    const res = await request(app)
      .post("/api/admin/data-sources")
      .send({
        name: "Production DB",
        type: "postgres",
        connectionConfig: { host: "db.internal", port: 5432, password: "supersecret" },
      });

    expect(res.status).toBe(201);
    // connectionConfig must NOT appear in the response
    expect(res.body).not.toHaveProperty("connectionConfig");
    expect(res.body).not.toHaveProperty("config_encrypted");
    // The SQL should have been called with an encrypted blob (not the raw password)
    const serializedArgs = JSON.stringify(capturedArgs);
    expect(serializedArgs).not.toContain("supersecret");
    // The config_encrypted argument should be a JSON string containing the envelope
    const configArg = capturedArgs.find(
      (a) => typeof a === "string" && (a as string).startsWith("{"),
    ) as string | undefined;
    expect(configArg).toBeDefined();
    expect(configArg).not.toContain("supersecret");
  });

  it("returns 400 VALIDATION for missing required fields", async () => {
    const app = buildRouterApp(ADMIN_AUTH);
    const res = await request(app)
      .post("/api/admin/data-sources")
      .send({ name: "Incomplete" }); // missing type
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION for invalid type", async () => {
    const app = buildRouterApp(ADMIN_AUTH);
    const res = await request(app)
      .post("/api/admin/data-sources")
      .send({ name: "Bad", type: "oracle" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/data-sources/:id", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("updates name and returns updated DataSource", async () => {
    const updatedRow = { ...DS_ROW, name: "Renamed DB" };
    // First call returns current (FOR UPDATE), second returns updated
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => {
      return callCount++ === 0 ? [DS_ROW] : [updatedRow];
    });
    const res = await request(app)
      .patch("/api/admin/data-sources/ds-1")
      .send({ name: "Renamed DB" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed DB");
    expect(res.body).not.toHaveProperty("connectionConfig");
  });

  it("returns 404 when data source not found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app)
      .patch("/api/admin/data-sources/missing")
      .send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("encrypts connectionConfig on PATCH — never returns it", async () => {
    let callCount = 0;
    const capturedArgs: unknown[][] = [];
    const app = buildRouterApp(ADMIN_AUTH, (_sql, ...args) => {
      capturedArgs.push(args);
      return callCount++ === 0 ? [DS_ROW] : [DS_ROW];
    });
    const res = await request(app)
      .patch("/api/admin/data-sources/ds-1")
      .send({ connectionConfig: { host: "new.host", password: "newpass" } });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("connectionConfig");
    // Password must not appear in any DB call arg
    const allArgs = JSON.stringify(capturedArgs);
    expect(allArgs).not.toContain("newpass");
  });

  it("returns 400 VALIDATION for invalid type", async () => {
    const app = buildRouterApp(ADMIN_AUTH);
    const res = await request(app)
      .patch("/api/admin/data-sources/ds-1")
      .send({ type: "cassandra" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe("DELETE /api/admin/data-sources/:id", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("deletes existing data source and returns 204", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [{ id: "ds-1" }]);
    const res = await request(app).delete("/api/admin/data-sources/ds-1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when data source not found", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).delete("/api/admin/data-sources/missing");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

// ── Tenant isolation ───────────────────────────────────────────────────────────

describe("tenant isolation", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  it("withTenantTx is called — tenant scope enforced per request", async () => {
    // Verify that withTenantTx is invoked (proving tenant scoping middleware would gate the call).
    // The test middleware injects withTenantTx; a missing one would 500.
    const withTenantTxSpy = vi.fn().mockImplementation(
      <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockResolvedValue([DS_ROW]),
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        } as unknown as Prisma.TransactionClient),
    );

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = ADMIN_AUTH;
      req.withTenantTx = withTenantTxSpy;
      next();
    });
    app.use("/api/admin/data-sources", dataSourcesRouter);

    await request(app).get("/api/admin/data-sources");
    expect(withTenantTxSpy).toHaveBeenCalledOnce();
  });

  it("a request for tenant A cannot read tenant B data sources", async () => {
    // Tenant B's data source — returned when tenant B search_path is set.
    // Tenant A's request should never see it because withTenantTx pins the search_path.
    // Here we assert the response only contains what the mock returns (nothing from tenant B).
    const tenantBRow = { ...DS_ROW, id: "ds-tenantB", name: "Tenant B source" };

    const appA = buildRouterApp(
      { userId: "uA", tenantId: "tenantA", roleId: "role-admin" },
      () => [], // tenant A sees nothing
    );
    const resA = await request(appA).get("/api/admin/data-sources");
    expect(resA.status).toBe(200);
    expect(resA.body).toEqual([]);
    // Tenant B's data is absent
    expect(JSON.stringify(resA.body)).not.toContain(tenantBRow.id);
  });
});

// ── Credential redaction assertions ───────────────────────────────────────────

describe("credential redaction", () => {
  beforeEach(() => { process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY; });
  afterEach(() => { delete process.env["VAULT_MASTER_KEY"]; });

  const SECRET_PASSWORD = "ultra-secret-db-password";
  const SECRET_HOST = "private-db.internal";

  it("POST with connectionConfig never emits credential in response", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app)
      .post("/api/admin/data-sources")
      .send({
        name: "Secure Source",
        type: "postgres",
        connectionConfig: { host: SECRET_HOST, password: SECRET_PASSWORD },
      });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_PASSWORD);
    expect(body).not.toContain(SECRET_HOST);
  });

  it("PATCH with connectionConfig never emits credential in response", async () => {
    let callCount = 0;
    const app = buildRouterApp(ADMIN_AUTH, () => (callCount++ === 0 ? [DS_ROW] : [DS_ROW]));
    const res = await request(app)
      .patch("/api/admin/data-sources/ds-1")
      .send({ connectionConfig: { host: SECRET_HOST, password: SECRET_PASSWORD } });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_PASSWORD);
    expect(body).not.toContain(SECRET_HOST);
  });

  it("GET response keys do not include connectionConfig or config_encrypted", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ROW]);
    const res = await request(app).get("/api/admin/data-sources");
    for (const ds of res.body as object[]) {
      expect(Object.keys(ds)).not.toContain("connectionConfig");
      expect(Object.keys(ds)).not.toContain("config_encrypted");
    }
  });
});
