import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

// Prevent lazy singleton from attempting a DB connection at import time.
vi.mock("../db/client.js", () => ({ getPrisma: vi.fn() }));

import { provisionTenant } from "./provision.js";

const executedSqls: string[] = [];
const mockTx = {
  $executeRawUnsafe: vi.fn(async (sql: string) => {
    executedSqls.push(sql.trim().split("\n")[0]!.trim());
    return 0;
  }),
};

const mockTransaction = vi.fn();
const mockClient = {
  $transaction: mockTransaction,
} as unknown as PrismaClient;

beforeEach(() => {
  executedSqls.length = 0;
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)
  );
});

describe("provisionTenant", () => {
  it("creates the tenant schema", async () => {
    await provisionTenant("abc123", mockClient);
    expect(executedSqls[0]).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_abc123"');
  });

  it("creates all required tables", async () => {
    await provisionTenant("abc123", mockClient);
    const allSql = executedSqls.join(" ");
    for (const table of [
      "roles",
      "data_sources",
      "resource_grants",
      "users",
      "cred_vault_refs",
      "conversations",
      "messages",
      "audit_events",
    ]) {
      expect(allSql).toContain(`"tenant_abc123"."${table}"`);
    }
  });

  it("uses IF NOT EXISTS for all DDL (idempotent)", async () => {
    await provisionTenant("abc123", mockClient);
    for (const sql of executedSqls) {
      expect(sql).toMatch(/IF NOT EXISTS/i);
    }
  });

  it("runs everything inside a single $transaction", async () => {
    await provisionTenant("abc123", mockClient);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("lowercases tenantId for the schema name", async () => {
    await provisionTenant("UPPER01", mockClient);
    expect(executedSqls[0]).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_upper01"');
  });

  it("rejects invalid tenantId before touching the DB", async () => {
    await expect(provisionTenant("", mockClient)).rejects.toThrow(
      "Invalid tenantId"
    );
    await expect(provisionTenant("bad-id", mockClient)).rejects.toThrow(
      "Invalid tenantId"
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("is callable twice without throwing (idempotency via mocks)", async () => {
    await provisionTenant("abc123", mockClient);
    await provisionTenant("abc123", mockClient);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });
});
