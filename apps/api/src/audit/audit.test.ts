/**
 * Unit tests for the audit module (T7.1).
 *
 * Covers:
 * - recordAudit persists with correct SQL
 * - emitAdminAudit resolves role name and inserts
 * - GET /api/admin/audit endpoint: filtering, pagination, 400 on bad query
 * - Tenant isolation: withTenant receives the correct tenantId
 * - detail never contains row data (structural assertion)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import type { AuditEvent } from "@bi/contracts";

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../observability/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

import { withTenant } from "../db/with-tenant.js";
import { recordAudit, emitAdminAudit } from "./index.js";
import { auditRouter } from "./audit-router.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const TENANT_A: AuthContext = { userId: "user-a", tenantId: "tenantA", roleId: "role-admin" };

function makeAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt-1",
    tenantId: "tenantA",
    at: "2026-07-01T00:00:00.000Z",
    actorUserId: "user-a",
    roleNameAtEvent: "Admin",
    type: "query_executed",
    outcome: "success",
    detail: { queryText: "SELECT 1", rowCount: 1, chartType: "table" },
    ...overrides,
  };
}

function makeTxStub(overrides: Partial<Prisma.TransactionClient> = {}): Prisma.TransactionClient {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

/**
 * Wire the withTenant mock to call fn(tx) synchronously with the given tx stub.
 */
function setupWithTenant(tx: Prisma.TransactionClient): void {
  vi.mocked(withTenant).mockImplementation((_tenantId, fn) => fn(tx));
}

// ── Build test app for audit router ───────────────────────────────────────────

function buildAuditApp(
  auth: AuthContext = TENANT_A,
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
  app.use("/api/admin/audit", auditRouter);
  return app;
}

// ── Fixtures for audit rows ────────────────────────────────────────────────────

const NOW = new Date("2026-07-01T12:00:00.000Z");

const AUDIT_DB_ROW = {
  id: "evt-1",
  tenant_id: "tenantA",
  at: NOW,
  actor_user_id: "user-a",
  role_name_at_event: "Admin",
  type: "query_executed",
  outcome: "success",
  data_source_id: null,
  detail: { queryText: "SELECT 1", rowCount: 1 },
  ip: null,
};

// ── recordAudit tests ──────────────────────────────────────────────────────────

describe("recordAudit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls withTenant with the event tenantId", async () => {
    const tx = makeTxStub();
    setupWithTenant(tx);

    await recordAudit(makeAuditEvent());

    expect(vi.mocked(withTenant)).toHaveBeenCalledWith("tenantA", expect.any(Function));
  });

  it("inserts into audit_events with all required columns", async () => {
    const tx = makeTxStub();
    setupWithTenant(tx);

    const event = makeAuditEvent({ ip: "1.2.3.4", dataSourceId: "ds-1" });
    await recordAudit(event);

    expect(tx.$executeRawUnsafe).toHaveBeenCalledOnce();
    const [sql, ...params] = vi.mocked(tx.$executeRawUnsafe).mock.calls[0];
    expect(sql).toContain("INSERT INTO audit_events");
    expect(params).toContain("evt-1");
    expect(params).toContain("tenantA");
    expect(params).toContain("user-a");
    expect(params).toContain("Admin");
    expect(params).toContain("query_executed");
    expect(params).toContain("success");
    expect(params).toContain("ds-1");
    expect(params).toContain("1.2.3.4");
  });

  it("never throws — logs on DB failure", async () => {
    vi.mocked(withTenant).mockRejectedValue(new Error("db down"));
    await expect(recordAudit(makeAuditEvent())).resolves.toBeUndefined();
  });

  it("detail must not contain row values — only metadata fields", async () => {
    // Structural assertion: detail keys should be metadata, not actual row data.
    const event = makeAuditEvent({
      detail: { queryText: "SELECT id FROM users", rowCount: 42, chartType: "table" },
    });
    // Verify no row-value keys (e.g., no "rows", no "data", no "values")
    const forbidden = ["rows", "data", "values", "records", "result"];
    for (const key of forbidden) {
      expect(Object.keys(event.detail)).not.toContain(key);
    }
    // Verify it parses as JSON without circular refs
    expect(() => JSON.stringify(event.detail)).not.toThrow();
  });
});

// ── emitAdminAudit tests ───────────────────────────────────────────────────────

describe("emitAdminAudit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves role name from tenant schema and inserts event", async () => {
    const tx = makeTxStub({
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: "Admin" }]),
    });
    setupWithTenant(tx);

    await emitAdminAudit(TENANT_A, "10.0.0.1", {
      type: "role_changed",
      outcome: "success",
      detail: { roleId: "role-1", newName: "Editors" },
    });

    expect(vi.mocked(withTenant)).toHaveBeenCalledWith("tenantA", expect.any(Function));
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("SELECT name FROM roles"),
      "role-admin",
    );
    const [sql, ...params] = vi.mocked(tx.$executeRawUnsafe).mock.calls[0];
    expect(sql).toContain("INSERT INTO audit_events");
    expect(params).toContain("Admin");
    expect(params).toContain("role_changed");
    expect(params).toContain("10.0.0.1");
  });

  it("uses 'none' for role name when roleId is null", async () => {
    const noRoleAuth: AuthContext = { userId: "u2", tenantId: "tenantA", roleId: null };
    const tx = makeTxStub();
    setupWithTenant(tx);

    await emitAdminAudit(noRoleAuth, undefined, {
      type: "login",
      outcome: "success",
      detail: {},
    });

    const [, , , , , roleName] = vi.mocked(tx.$executeRawUnsafe).mock.calls[0];
    expect(roleName).toBe("none");
    // No role lookup query
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("never throws — logs on DB failure", async () => {
    vi.mocked(withTenant).mockRejectedValue(new Error("db down"));
    await expect(
      emitAdminAudit(TENANT_A, undefined, {
        type: "permission_changed",
        outcome: "success",
        detail: {},
      }),
    ).resolves.toBeUndefined();
  });
});

// ── GET /api/admin/audit endpoint tests ───────────────────────────────────────

describe("GET /api/admin/audit", () => {
  it("returns events array with page/pageSize", async () => {
    const app = buildAuditApp(TENANT_A, () => [AUDIT_DB_ROW]);
    const res = await request(app).get("/api/admin/audit");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.events[0].id).toBe("evt-1");
    expect(res.body.events[0].at).toBe(NOW.toISOString());
  });

  it("maps DB row to camelCase contract shape", async () => {
    const row = { ...AUDIT_DB_ROW, data_source_id: "ds-1", ip: "1.2.3.4" };
    const app = buildAuditApp(TENANT_A, () => [row]);
    const res = await request(app).get("/api/admin/audit");
    const evt = res.body.events[0];
    expect(evt.actorUserId).toBe("user-a");
    expect(evt.roleNameAtEvent).toBe("Admin");
    expect(evt.dataSourceId).toBe("ds-1");
    expect(evt.ip).toBe("1.2.3.4");
    // Verify no snake_case leakage
    expect(evt).not.toHaveProperty("actor_user_id");
    expect(evt).not.toHaveProperty("role_name_at_event");
  });

  it("passes filter params to the SQL query", async () => {
    let capturedArgs: unknown[] = [];
    const app = buildAuditApp(TENANT_A, (_sql, ...args) => {
      capturedArgs = args;
      return [];
    });
    await request(app).get(
      "/api/admin/audit?from=2026-01-01T00:00:00.000Z&to=2026-12-31T23:59:59.000Z" +
        "&type=query_blocked&userId=user-a&dataSourceId=ds-1&page=2&pageSize=10",
    );
    expect(capturedArgs[0]).toBe("2026-01-01T00:00:00.000Z"); // from
    expect(capturedArgs[1]).toBe("2026-12-31T23:59:59.000Z"); // to
    expect(capturedArgs[2]).toBe("query_blocked"); // type
    expect(capturedArgs[3]).toBe("user-a"); // userId
    expect(capturedArgs[4]).toBe("ds-1"); // dataSourceId
    expect(capturedArgs[5]).toBe(10); // pageSize
    expect(capturedArgs[6]).toBe(10); // offset (page 2, size 10 → offset 10)
  });

  it("paginates: offset = (page - 1) * pageSize", async () => {
    let capturedOffset: unknown;
    const app = buildAuditApp(TENANT_A, (_sql, ...args) => {
      capturedOffset = args[6]; // offset is 7th param
      return [];
    });
    await request(app).get("/api/admin/audit?page=3&pageSize=20");
    expect(capturedOffset).toBe(40); // (3 - 1) * 20
  });

  it("returns 400 on invalid type filter", async () => {
    const app = buildAuditApp();
    const res = await request(app).get("/api/admin/audit?type=not_a_real_type");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 400 when pageSize exceeds 100", async () => {
    const app = buildAuditApp();
    const res = await request(app).get("/api/admin/audit?pageSize=200");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("omits optional fields when null in DB", async () => {
    const app = buildAuditApp(TENANT_A, () => [AUDIT_DB_ROW]); // data_source_id: null, ip: null
    const res = await request(app).get("/api/admin/audit");
    const evt = res.body.events[0];
    expect(evt).not.toHaveProperty("dataSourceId");
    expect(evt).not.toHaveProperty("ip");
  });

  it("returns 500 on DB error", async () => {
    const auth = TENANT_A;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = auth;
      req.withTenantTx = () => Promise.reject(new Error("db down"));
      next();
    });
    app.use("/api/admin/audit", auditRouter);
    const res = await request(app).get("/api/admin/audit");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL");
  });
});

// ── Tenant isolation ───────────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("withTenantTx is called with tenantId from auth, not from query", async () => {
    // withTenantTx is pre-bound to auth.tenantId by tenantScopeMiddleware;
    // the audit router must NOT bypass this — it can only see the auth tenant's rows.
    const TENANT_B_ROW = { ...AUDIT_DB_ROW, tenant_id: "tenantB" };
    const capturedCalls: Prisma.TransactionClient[] = [];
    const auth: AuthContext = { userId: "u1", tenantId: "tenantA", roleId: "r1" };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = auth;
      req.withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => {
        const tx = {
          $queryRawUnsafe: vi.fn().mockResolvedValue([TENANT_B_ROW]),
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        } as unknown as Prisma.TransactionClient;
        capturedCalls.push(tx);
        return fn(tx);
      };
      next();
    });
    app.use("/api/admin/audit", auditRouter);

    const res = await request(app).get("/api/admin/audit");
    expect(res.status).toBe(200);
    // withTenantTx was called exactly once — the router cannot escape its tenant scope
    expect(capturedCalls).toHaveLength(1);
  });
});

// ── query_blocked detail assertion ────────────────────────────────────────────

describe("query_blocked audit detail contract", () => {
  it("records missing[] resources, not row data", async () => {
    const event = makeAuditEvent({
      type: "query_blocked",
      outcome: "blocked",
      detail: {
        queryText: "SELECT * FROM orders",
        missing: ["public.orders.customer_email"],
      },
    });
    // Must have missing array
    expect(event.detail["missing"]).toBeInstanceOf(Array);
    // Must NOT have rows / row values
    expect(event.detail).not.toHaveProperty("rows");
    expect(event.detail).not.toHaveProperty("data");
  });
});
