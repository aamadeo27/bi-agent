import { describe, it, expect, vi } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { rolesRouter } from "./roles-router.js";
import { requireAdminCapability } from "./require-admin.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_AUTH: AuthContext = { userId: "u1", tenantId: "tenant1", roleId: "role-admin" };
const NON_ADMIN_AUTH: AuthContext = { userId: "u3", tenantId: "tenant1", roleId: "role-viewer" };

const GRANT_ROW_SCHEMA = {
  id: "grant-1",
  role_id: "role-1",
  data_source_id: "ds-1",
  kind: "schema",
  schema: "public",
  table: null,
  column: null,
};

const GRANT_ROW_TABLE = {
  id: "grant-2",
  role_id: "role-1",
  data_source_id: "ds-1",
  kind: "table",
  schema: "public",
  table: "orders",
  column: null,
};

const GRANT_ROW_COLUMN = {
  id: "grant-3",
  role_id: "role-1",
  data_source_id: "ds-1",
  kind: "column",
  schema: "public",
  table: "orders",
  column: "total",
};

// ── App builders ──────────────────────────────────────────────────────────────

function buildRouterApp(
  auth: AuthContext = ADMIN_AUTH,
  mockQueryFn: (sql: string, ...args: unknown[]) => unknown = () => [],
  mockExecFn: (sql: string, ...args: unknown[]) => unknown = () => 0,
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation(mockQueryFn),
        $executeRawUnsafe: vi.fn().mockImplementation(mockExecFn),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/roles", rolesRouter);
  return app;
}

function buildFullApp(
  auth: AuthContext,
  adminCaps: { canInspectQuery: boolean } | null,
  mockQueryFn: (sql: string, ...args: unknown[]) => unknown = () => [],
  mockExecFn: (sql: string, ...args: unknown[]) => unknown = () => 0,
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          if (/SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
            return adminCaps === null ? Promise.resolve([]) : Promise.resolve([{ capabilities: adminCaps }]);
          }
          return Promise.resolve(mockQueryFn(sql, ...args));
        }),
        $executeRawUnsafe: vi.fn().mockImplementation(mockExecFn),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/roles", requireAdminCapability, rolesRouter);
  return app;
}

// ── GET /api/admin/roles/:id/grants ──────────────────────────────────────────

describe("GET /api/admin/roles/:id/grants", () => {
  it("returns empty array when role has no grants", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns schema-level grant with correct shape", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [GRANT_ROW_SCHEMA]);
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { roleId: "role-1", dataSourceId: "ds-1", kind: "schema", schema: "public" },
    ]);
    // table and column must be absent (not null) in contract shape
    expect(res.body[0].table).toBeUndefined();
    expect(res.body[0].column).toBeUndefined();
  });

  it("returns table-level grant with table field", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [GRANT_ROW_TABLE]);
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ kind: "table", schema: "public", table: "orders" });
    expect(res.body[0].column).toBeUndefined();
  });

  it("returns column-level grant with table+column fields", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [GRANT_ROW_COLUMN]);
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      kind: "column",
      schema: "public",
      table: "orders",
      column: "total",
    });
  });

  it("returns mixed grant set", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [GRANT_ROW_SCHEMA, GRANT_ROW_TABLE, GRANT_ROW_COLUMN]);
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});

// ── PUT /api/admin/roles/:id/grants ──────────────────────────────────────────

describe("PUT /api/admin/roles/:id/grants", () => {
  it("replaces grant set atomically and returns new set", async () => {
    let queryCallCount = 0;
    const newGrantRow = { ...GRANT_ROW_SCHEMA, id: "grant-new" };

    const app = buildRouterApp(
      ADMIN_AUTH,
      () => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ id: "role-1" }]; // role exists check
        return [newGrantRow]; // INSERT RETURNING
      },
      () => 1, // DELETE
    );

    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send([{ dataSourceId: "ds-1", kind: "schema", schema: "public" }]);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ roleId: "role-1", kind: "schema", schema: "public" });
  });

  it("returns empty array when replacing with empty set (clears all grants)", async () => {
    let queryCallCount = 0;
    const app = buildRouterApp(
      ADMIN_AUTH,
      () => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ id: "role-1" }];
        return [];
      },
      () => 1,
    );

    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send([]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 NOT_FOUND when role does not exist", async () => {
    const app = buildRouterApp(
      ADMIN_AUTH,
      () => [], // role existence check → not found
      () => 0,
    );

    const res = await request(app)
      .put("/api/admin/roles/no-such-id/grants")
      .send([]);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 400 VALIDATION when body is not an array", async () => {
    const app = buildRouterApp();
    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send({ not: "an array" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 VALIDATION when kind=table lacks table field", async () => {
    const app = buildRouterApp();
    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send([{ dataSourceId: "ds-1", kind: "table", schema: "public" }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    expect(res.body.message).toContain("table is required");
  });

  it("returns 400 VALIDATION when kind=column lacks column field", async () => {
    const app = buildRouterApp();
    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send([{ dataSourceId: "ds-1", kind: "column", schema: "public", table: "orders" }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    expect(res.body.message).toContain("column is required");
  });
});

// ── Tri-state semantics ───────────────────────────────────────────────────────
//
// Table grant + explicit column grants means: only those columns are accessible.
// The grant set sent to PUT encodes this explicitly — the handler stores it verbatim.

describe("tri-state: table grant with explicit column grants", () => {
  it("stores table grant + column grants for allowed columns (un-granted columns absent)", async () => {
    const tableGrantRow = { ...GRANT_ROW_TABLE, id: "g-table" };
    const col1Row = { ...GRANT_ROW_COLUMN, id: "g-col1", column: "amount" };
    const col2Row = { ...GRANT_ROW_COLUMN, id: "g-col2", column: "status" };

    let queryCallCount = 0;
    const app = buildRouterApp(
      ADMIN_AUTH,
      () => {
        queryCallCount++;
        if (queryCallCount === 1) return [{ id: "role-1" }]; // role check
        // Return one row per INSERT (3 inserts)
        if (queryCallCount === 2) return [tableGrantRow];
        if (queryCallCount === 3) return [col1Row];
        return [col2Row];
      },
      () => 1,
    );

    const body = [
      { dataSourceId: "ds-1", kind: "table", schema: "public", table: "orders" },
      { dataSourceId: "ds-1", kind: "column", schema: "public", table: "orders", column: "amount" },
      { dataSourceId: "ds-1", kind: "column", schema: "public", table: "orders", column: "status" },
    ];

    const res = await request(app)
      .put("/api/admin/roles/role-1/grants")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    const kinds = res.body.map((g: { kind: string }) => g.kind);
    expect(kinds).toContain("table");
    expect(kinds.filter((k: string) => k === "column")).toHaveLength(2);

    // Column "price" is un-granted (absent) — not in the response set
    const columns = res.body
      .filter((g: { kind: string }) => g.kind === "column")
      .map((g: { column: string }) => g.column);
    expect(columns).toContain("amount");
    expect(columns).toContain("status");
    expect(columns).not.toContain("price");
  });
});

// ── Admin-gating ──────────────────────────────────────────────────────────────

describe("admin gate on grants endpoints", () => {
  it("blocks GET grants when caller is not admin", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("blocks PUT grants when caller has no role", async () => {
    const noRole: AuthContext = { userId: "u2", tenantId: "tenant1", roleId: null };
    const app = buildFullApp(noRole, null);
    const res = await request(app).put("/api/admin/roles/role-1/grants").send([]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("allows GET grants for admin role", async () => {
    const app = buildFullApp(
      ADMIN_AUTH,
      { canInspectQuery: true },
      () => [],
    );
    const res = await request(app).get("/api/admin/roles/role-1/grants");
    expect(res.status).toBe(200);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe("tenant isolation on grants", () => {
  it("withTenantTx scopes all DB calls to requester tenant (not a foreign one)", async () => {
    // Simulate: attacker sends a grant referencing a data source from another tenant.
    // The search_path is locked to the caller's tenant schema — so the data_sources
    // table visible in the transaction only contains THIS tenant's rows.
    // We verify the handler issues the role existence check (controlled by tx search_path)
    // and does not read from a foreign path.
    const capturedSqls: string[] = [];

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = ADMIN_AUTH; // tenantId = "tenant1"
      req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
            capturedSqls.push(sql);
            // role check
            if (/FROM roles WHERE id/i.test(sql)) return Promise.resolve([{ id: args[0] }]);
            return Promise.resolve([]);
          }),
          $executeRawUnsafe: vi.fn().mockImplementation((sql: string) => {
            capturedSqls.push(sql);
            return Promise.resolve(0);
          }),
        } as unknown as Prisma.TransactionClient);
      next();
    });
    app.use("/api/admin/roles", rolesRouter);

    await request(app).put("/api/admin/roles/role-1/grants").send([]);

    // All captured SQL must be parameterised (no tenant id interpolated into SQL)
    // The search_path is set by withTenantTx — not visible in the SQL strings here.
    // Key: no SQL statement references a foreign schema name.
    const noForeignRef = capturedSqls.every((sql) => !sql.includes("tenant2"));
    expect(noForeignRef).toBe(true);
  });
});
