/**
 * Integration tests — run against a real PostgreSQL instance via Testcontainers.
 * Verifies: provisionTenant idempotency, cross-tenant isolation (FR-AC-6,
 * NFR-SEC-4, GAP-6), and absence of search_path leakage after withTenant.
 *
 * Requires Docker. Skipped gracefully when SKIP_DB_INTEGRATION_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../tenant/provision.js";
import { withTenant } from "./with-tenant.js";

const skip = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";

describe.skipIf(skip)("tenant isolation (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let client: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("bi_test")
      .withUsername("bi_test")
      .withPassword("bi_test")
      .start();

    client = new PrismaClient({
      datasources: { db: { url: container.getConnectionUri() } },
      log: [],
    });

    // Provision two isolated tenant schemas
    await provisionTenant("testa", client);
    await provisionTenant("testb", client);
  }, 60_000);

  afterAll(async () => {
    await client.$disconnect();
    await container.stop();
  }, 30_000);

  it("provisionTenant is idempotent — calling twice does not throw", async () => {
    await expect(provisionTenant("testa", client)).resolves.toBeUndefined();
  });

  it(
    "objects created in tenant_A are not visible from tenant_B",
    async () => {
      // Insert a role in tenant_A
      await withTenant(
        "testa",
        async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO roles (id, name, capabilities)
             VALUES ('role-isolation-test', 'admin', '{"canInspectQuery": false}')`
          );
        },
        client
      );

      // Querying the same id from tenant_B should return nothing
      const rows = await withTenant(
        "testb",
        (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM roles WHERE id = 'role-isolation-test'`
          ),
        client
      );

      expect(rows).toHaveLength(0);
    },
    15_000
  );

  it(
    "data inserted in tenant_A is visible within the same tenant_A context",
    async () => {
      const rows = await withTenant(
        "testa",
        (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM roles WHERE id = 'role-isolation-test'`
          ),
        client
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("role-isolation-test");
    },
    15_000
  );

  it(
    "search_path does not persist on the pooled connection after withTenant",
    async () => {
      await withTenant(
        "testa",
        async (tx) => {
          await tx.$executeRawUnsafe("SELECT 1");
        },
        client
      );

      // Outside any withTenant transaction the path must not contain 'testa'
      const result = await client.$queryRawUnsafe<
        Array<{ search_path: string }>
      >("SHOW search_path");

      expect(result[0]?.search_path).not.toContain("testa");
    },
    15_000
  );

  it("withTenant rejects invalid tenantIds before touching the DB", async () => {
    await expect(
      withTenant("DROP TABLE--", async (_tx) => {}, client)
    ).rejects.toThrow("Invalid tenantId");

    await expect(
      withTenant("../evil", async (_tx) => {}, client)
    ).rejects.toThrow("Invalid tenantId");
  });
});
