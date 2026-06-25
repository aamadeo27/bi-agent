import { describe, it, expect, vi } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { schemaRouter } from "./schema-router.js";
import { requireAdminCapability } from "./require-admin.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_AUTH: AuthContext = { userId: "u1", tenantId: "tenant1", roleId: "role-admin" };
const NON_ADMIN_AUTH: AuthContext = { userId: "u3", tenantId: "tenant1", roleId: "role-viewer" };

const DS_CONNECTED = { id: "ds-1", status: "connected" };
const DS_ERROR = { id: "ds-2", status: "error" };
const DS_UNCONFIGURED = { id: "ds-3", status: "unconfigured" };

// ── App builders ──────────────────────────────────────────────────────────────

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
  app.use("/api/admin/schema", schemaRouter);
  return app;
}

function buildFullApp(
  auth: AuthContext,
  adminCaps: { canInspectQuery: boolean } | null,
  mockQueryFn: (sql: string, ...args: unknown[]) => unknown = () => [],
): Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          if (/SELECT\s+capabilities\s+FROM\s+roles\s+WHERE/i.test(sql)) {
            return adminCaps === null
              ? Promise.resolve([])
              : Promise.resolve([{ capabilities: adminCaps }]);
          }
          return Promise.resolve(mockQueryFn(sql, ...args));
        }),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      } as unknown as Prisma.TransactionClient);
    next();
  });
  app.use("/api/admin/schema", requireAdminCapability, schemaRouter);
  return app;
}

// ── GET /api/admin/schema/:dataSourceId ──────────────────────────────────────

describe("GET /api/admin/schema/:dataSourceId", () => {
  it("returns schema tree with dataSourceId and empty schemas for connected source", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_CONNECTED]);
    const res = await request(app).get("/api/admin/schema/ds-1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dataSourceId: "ds-1", schemas: [] });
  });

  it("returns empty schemas for error-status data source", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_ERROR]);
    const res = await request(app).get("/api/admin/schema/ds-2");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dataSourceId: "ds-2", schemas: [] });
  });

  it("returns empty schemas for unconfigured data source", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_UNCONFIGURED]);
    const res = await request(app).get("/api/admin/schema/ds-3");
    expect(res.status).toBe(200);
    expect(res.body.schemas).toEqual([]);
  });

  it("returns 404 NOT_FOUND when data source does not exist", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => []);
    const res = await request(app).get("/api/admin/schema/no-such-ds");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("response shape matches SchemaTree contract (dataSourceId + schemas array)", async () => {
    const app = buildRouterApp(ADMIN_AUTH, () => [DS_CONNECTED]);
    const res = await request(app).get("/api/admin/schema/ds-1");
    expect(res.status).toBe(200);
    expect(typeof res.body.dataSourceId).toBe("string");
    expect(Array.isArray(res.body.schemas)).toBe(true);
  });
});

// ── Admin-gating ──────────────────────────────────────────────────────────────

describe("admin gate on schema endpoint", () => {
  it("blocks non-admin from accessing schema tree", async () => {
    const app = buildFullApp(NON_ADMIN_AUTH, { canInspectQuery: false });
    const res = await request(app).get("/api/admin/schema/ds-1");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("blocks caller with no role from accessing schema tree", async () => {
    const noRole: AuthContext = { userId: "u2", tenantId: "tenant1", roleId: null };
    const app = buildFullApp(noRole, null);
    const res = await request(app).get("/api/admin/schema/ds-1");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("allows admin to access schema tree", async () => {
    const app = buildFullApp(
      ADMIN_AUTH,
      { canInspectQuery: true },
      () => [DS_CONNECTED],
    );
    const res = await request(app).get("/api/admin/schema/ds-1");
    expect(res.status).toBe(200);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe("tenant isolation on schema endpoint", () => {
  it("queries data_sources within the tenant-scoped transaction (no foreign schema access)", async () => {
    const capturedSqls: string[] = [];

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = ADMIN_AUTH;
      req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockImplementation((sql: string) => {
            capturedSqls.push(sql);
            return Promise.resolve([DS_CONNECTED]);
          }),
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        } as unknown as Prisma.TransactionClient);
      next();
    });
    app.use("/api/admin/schema", schemaRouter);

    await request(app).get("/api/admin/schema/ds-1");

    // Data source lookup is parameterised — no tenant id baked into SQL
    expect(capturedSqls.some((sql) => /data_sources/i.test(sql))).toBe(true);
    expect(capturedSqls.every((sql) => !sql.includes("tenant2"))).toBe(true);
  });
});
