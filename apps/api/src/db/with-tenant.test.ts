import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, Prisma } from "@prisma/client";

// Prevent the lazy singleton from attempting a DB connection at import time.
vi.mock("./client.js", () => ({ getPrisma: vi.fn() }));

import { withTenant } from "./with-tenant.js";

const mockExecuteRawUnsafe = vi.fn().mockResolvedValue(0);
const mockTx = {
  $executeRawUnsafe: mockExecuteRawUnsafe,
} as unknown as Prisma.TransactionClient;

const mockTransaction = vi.fn();
const mockClient = {
  $transaction: mockTransaction,
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)
  );
});

describe("withTenant", () => {
  it("wraps work in $transaction", async () => {
    await withTenant("abc123", async (_tx) => {}, mockClient);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("issues SET LOCAL search_path as first statement", async () => {
    await withTenant("abc123", async (_tx) => {}, mockClient);
    expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "tenant_abc123", platform'
    );
  });

  it("normalises tenantId to lowercase in schema name", async () => {
    await withTenant("ABCDEF01", async (_tx) => {}, mockClient);
    expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "tenant_abcdef01", platform'
    );
  });

  it("passes the transaction client to fn", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withTenant("abc123", fn, mockClient);
    expect(fn).toHaveBeenCalledWith(mockTx);
    expect(result).toBe("ok");
  });

  it("propagates the return value of fn", async () => {
    const result = await withTenant(
      "abc123",
      async (_tx) => ({ count: 7 }),
      mockClient
    );
    expect(result).toEqual({ count: 7 });
  });

  it("rejects an empty tenantId", async () => {
    await expect(
      withTenant("", async (_tx) => {}, mockClient)
    ).rejects.toThrow("Invalid tenantId");
  });

  it("rejects tenantId with hyphens or dots", async () => {
    await expect(
      withTenant("tenant-id", async (_tx) => {}, mockClient)
    ).rejects.toThrow("Invalid tenantId");
    await expect(
      withTenant("../evil", async (_tx) => {}, mockClient)
    ).rejects.toThrow("Invalid tenantId");
  });

  it("rejects SQL injection attempts in tenantId", async () => {
    await expect(
      withTenant("DROP TABLE--", async (_tx) => {}, mockClient)
    ).rejects.toThrow("Invalid tenantId");
    await expect(
      withTenant('"injected"', async (_tx) => {}, mockClient)
    ).rejects.toThrow("Invalid tenantId");
  });

  it("accepts ULID-format tenantIds", async () => {
    await expect(
      withTenant("01ARZ3NDEKTSV4RRFFQ69G5FAV", async (_tx) => {}, mockClient)
    ).resolves.toBeUndefined();
  });
});
