import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports of the mocked modules.
// ---------------------------------------------------------------------------

vi.mock("../db/with-tenant.js");
vi.mock("../observability/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { withTenant } from "../db/with-tenant.js";
import { logger } from "../observability/logger.js";
import { purgeExpiredConversations, DEFAULT_RETENTION_DAYS } from "./retention-purge.js";

const mockWithTenant = vi.mocked(withTenant);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildMockDb(tenantIds: string[]): PrismaClient {
  return {
    tenant: {
      findMany: vi.fn().mockResolvedValue(tenantIds.map((id) => ({ id }))),
    },
  } as unknown as PrismaClient;
}

function buildMockTx(deletedCount: number): Prisma.TransactionClient {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ deleted_count: deletedCount }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
  } as unknown as Prisma.TransactionClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: execute the fn with a tx returning 0 deleted rows.
  mockWithTenant.mockImplementation(async (_tenantId, fn) => {
    return fn(buildMockTx(0));
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("purgeExpiredConversations", () => {
  describe("tenant scoping", () => {
    it("calls withTenant once per tenant, with the correct tenantId and db client", async () => {
      const db = buildMockDb(["t1", "t2"]);

      await purgeExpiredConversations({}, db);

      expect(mockWithTenant).toHaveBeenCalledTimes(2);
      expect(mockWithTenant).toHaveBeenCalledWith("t1", expect.any(Function), db);
      expect(mockWithTenant).toHaveBeenCalledWith("t2", expect.any(Function), db);
    });

    it("handles zero tenants — no withTenant calls, no errors", async () => {
      const db = buildMockDb([]);

      const result = await purgeExpiredConversations({}, db);

      expect(mockWithTenant).not.toHaveBeenCalled();
      expect(result.summaries).toEqual([]);
      expect(result.tenantsProcessed).toBe(0);
      expect(result.tenantsErrored).toBe(0);
    });
  });

  describe("deletion logic", () => {
    it("deletes conversations older than the cutoff (passes olderThanDays as SQL param)", async () => {
      const db = buildMockDb(["t1"]);
      let capturedSql = "";
      let capturedParam: unknown;

      mockWithTenant.mockImplementation(async (_tenantId, fn) => {
        const tx = {
          $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...params: unknown[]) => {
            capturedSql = sql;
            capturedParam = params[0];
            return Promise.resolve([{ deleted_count: 3 }]);
          }),
        } as unknown as Prisma.TransactionClient;
        return fn(tx);
      });

      await purgeExpiredConversations({ olderThanDays: 365 }, db);

      expect(capturedSql).toContain("DELETE FROM conversations");
      expect(capturedSql).toMatch(/created_at\s*</);
      expect(capturedParam).toBe(365);
    });

    it("younger conversations are not deleted (cutoff param controls boundary)", async () => {
      const db = buildMockDb(["t1"]);
      let capturedParam: unknown;

      mockWithTenant.mockImplementation(async (_tenantId, fn) => {
        const tx = {
          $queryRawUnsafe: vi.fn().mockImplementation((_sql: string, ...params: unknown[]) => {
            capturedParam = params[0];
            return Promise.resolve([{ deleted_count: 0 }]);
          }),
        } as unknown as Prisma.TransactionClient;
        return fn(tx);
      });

      await purgeExpiredConversations({ olderThanDays: 30 }, db);

      // Cutoff param is 30, not 365 — only rows older than 30 days are matched.
      expect(capturedParam).toBe(30);
    });
  });

  describe("configurable retention window", () => {
    it("uses DEFAULT_RETENTION_DAYS (365) when olderThanDays is omitted", async () => {
      const db = buildMockDb(["t1"]);
      let capturedParam: unknown;

      mockWithTenant.mockImplementation(async (_tenantId, fn) => {
        const tx = {
          $queryRawUnsafe: vi.fn().mockImplementation((_sql: string, ...params: unknown[]) => {
            capturedParam = params[0];
            return Promise.resolve([{ deleted_count: 0 }]);
          }),
        } as unknown as Prisma.TransactionClient;
        return fn(tx);
      });

      await purgeExpiredConversations(undefined, db);

      expect(capturedParam).toBe(DEFAULT_RETENTION_DAYS);
      expect(DEFAULT_RETENTION_DAYS).toBe(365);
    });

    it("respects custom olderThanDays (e.g. 90)", async () => {
      const db = buildMockDb(["t1"]);
      let capturedParam: unknown;

      mockWithTenant.mockImplementation(async (_tenantId, fn) => {
        const tx = {
          $queryRawUnsafe: vi.fn().mockImplementation((_sql: string, ...params: unknown[]) => {
            capturedParam = params[0];
            return Promise.resolve([{ deleted_count: 0 }]);
          }),
        } as unknown as Prisma.TransactionClient;
        return fn(tx);
      });

      await purgeExpiredConversations({ olderThanDays: 90 }, db);

      expect(capturedParam).toBe(90);
    });
  });

  describe("idempotency", () => {
    it("returns zero deleted on second run without errors (nothing left to delete)", async () => {
      const db = buildMockDb(["t1"]);
      // Always returns 0 — nothing expired.
      mockWithTenant.mockImplementation(async (_tenantId, fn) => fn(buildMockTx(0)));

      const r1 = await purgeExpiredConversations({}, db);
      const r2 = await purgeExpiredConversations({}, db);

      expect(r1.tenantsErrored).toBe(0);
      expect(r2.tenantsErrored).toBe(0);
      expect(r2.summaries[0].deletedConversations).toBe(0);
    });
  });

  describe("audit summary event", () => {
    it("emits a structured info log per tenant with counts only, no PII", async () => {
      const db = buildMockDb(["t1"]);
      mockWithTenant.mockImplementation(async (_tenantId, fn) => fn(buildMockTx(7)));

      await purgeExpiredConversations({ olderThanDays: 365 }, db);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "retention_purge_summary",
          tenantId: "t1",
          deletedConversations: 7,
          olderThanDays: 365,
        }),
        expect.any(String),
      );

      // Ensure no row/PII data in the log payload.
      const auditCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.event === "retention_purge_summary",
      );
      expect(auditCall?.[0]).not.toHaveProperty("messages");
      expect(auditCall?.[0]).not.toHaveProperty("content");
      expect(auditCall?.[0]).not.toHaveProperty("userId");
    });

    it("emits one log per tenant", async () => {
      const db = buildMockDb(["ta", "tb", "tc"]);
      mockWithTenant.mockImplementation(async (_tenantId, fn) => fn(buildMockTx(1)));

      await purgeExpiredConversations({}, db);

      const summaryCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.event === "retention_purge_summary",
      );
      expect(summaryCalls).toHaveLength(3);
    });
  });

  describe("result shape", () => {
    it("returns correct counts per tenant", async () => {
      const db = buildMockDb(["ta", "tb"]);
      let callIdx = 0;
      mockWithTenant.mockImplementation(async (_tenantId, fn) => {
        return fn(buildMockTx(callIdx++ === 0 ? 5 : 2));
      });

      const result = await purgeExpiredConversations({}, db);

      expect(result.summaries).toHaveLength(2);
      expect(result.summaries[0]).toEqual({ tenantId: "ta", deletedConversations: 5 });
      expect(result.summaries[1]).toEqual({ tenantId: "tb", deletedConversations: 2 });
      expect(result.tenantsProcessed).toBe(2);
      expect(result.tenantsErrored).toBe(0);
    });

    it("continues processing remaining tenants when one fails, counts the error", async () => {
      const db = buildMockDb(["ok-1", "bad", "ok-2"]);
      mockWithTenant.mockImplementation(async (tenantId, fn) => {
        if (tenantId === "bad") throw new Error("DB timeout");
        return fn(buildMockTx(1));
      });

      const result = await purgeExpiredConversations({}, db);

      expect(result.tenantsErrored).toBe(1);
      expect(result.summaries).toHaveLength(2);
      expect(result.summaries.map((s) => s.tenantId)).toEqual(["ok-1", "ok-2"]);
    });

    it("logs an error for a failed tenant without leaking PII", async () => {
      const db = buildMockDb(["bad-tenant"]);
      const dbError = new Error("connection refused");
      mockWithTenant.mockRejectedValue(dbError);

      await purgeExpiredConversations({}, db);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "retention_purge_error",
          tenantId: "bad-tenant",
        }),
        expect.any(String),
      );
    });
  });
});
