/**
 * L2 integration test — least-privilege Postgres role enforcement.
 *
 * Proves NFR-SEC-1: a query touching a non-granted table is rejected at the
 * data-source layer even if it passes validation and reaches the proxy.
 *
 * Setup:
 *   - Superuser creates two tables: `public.allowed_table` + `public.restricted_table`
 *   - A least-privilege DB role `limited_role` receives SELECT only on `allowed_table`
 *   - The proxy is invoked with a credential for `limited_role`
 *   - withTenant is mocked at the top level (Vitest hoisting); implementation
 *     is updated per-test using vi.mocked().mockImplementation.
 *
 * Skipped when SKIP_DB_INTEGRATION_TESTS=1.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { encryptCredential } from "./vault.js";
import { ConnectorDataSourceError } from "./rest-connector.js";

// ── Top-level mock: withTenant ─────────────────────────────────────────────────
// Must be at the module level so Vitest can hoist it.

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

// Import SUT after mock declarations
import { withTenant } from "../db/with-tenant.js";
import { execute, _clearConnectorCache, _drainConnectorCache } from "./query-proxy.js";

const skip = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";

// ── Master key for vault round-trip in tests ───────────────────────────────────
const TEST_MASTER_KEY = "c".repeat(64);

describe.skipIf(skip)("QueryProxy L2 — least-privilege role (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let superPool: Pool;
  let encryptedLimitedCred: string;

  beforeAll(async () => {
    process.env["VAULT_MASTER_KEY"] = TEST_MASTER_KEY;

    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("test_db")
      .withUsername("super_user")
      .withPassword("super_pass")
      .start();

    const uri = container.getConnectionUri();
    superPool = new Pool({ connectionString: uri });

    // Create tables
    await superPool.query(`
      CREATE TABLE public.allowed_table (
        id   SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    await superPool.query(
      `INSERT INTO public.allowed_table (name) VALUES ('row_a'), ('row_b')`,
    );
    await superPool.query(`
      CREATE TABLE public.restricted_table (
        secret TEXT NOT NULL
      )
    `);
    await superPool.query(
      `INSERT INTO public.restricted_table (secret) VALUES ('top_secret')`,
    );

    // Create least-privilege role — SELECT on allowed_table only
    await superPool.query(
      `CREATE ROLE limited_role WITH LOGIN PASSWORD 'limited_pass'`,
    );
    await superPool.query(`GRANT CONNECT ON DATABASE test_db TO limited_role`);
    await superPool.query(`GRANT USAGE ON SCHEMA public TO limited_role`);
    await superPool.query(
      `GRANT SELECT ON public.allowed_table TO limited_role`,
    );
    // restricted_table: intentionally NOT granted

    // Pre-encrypt the limited-role credential
    const url = new URL(uri);
    encryptedLimitedCred = encryptCredential({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: "limited_role",
      password: "limited_pass",
      ssl: false,
    });
  }, 120_000);

  afterAll(async () => {
    // Drain pools BEFORE stopping the container so pg connections close cleanly.
    // Without this, the container's abrupt shutdown sends 57P01 on open sockets
    // which pg emits as an error; without a listener it becomes an uncaught exception.
    await _drainConnectorCache();
    await superPool.end();
    await container.stop();
    delete process.env["VAULT_MASTER_KEY"];
  }, 30_000);

  // ── Helper: wire withTenant mock to return our limited credential ─────────────

  function setupWithTenantMock(encryptedCred: string): void {
    vi.mocked(withTenant).mockImplementation(
      (_tenantId, fn) =>
        fn({
          $queryRawUnsafe: vi
            .fn()
            .mockResolvedValueOnce([{ type: "postgres" }])
            .mockResolvedValueOnce([{ encrypted_cred: encryptedCred }]),
        } as never) as Promise<never>,
    );
  }

  // ── Tests ──────────────────────────────────────────────────────────────────────

  it("allows SELECT on a granted table (L2 passes)", async () => {
    _clearConnectorCache();
    setupWithTenantMock(encryptedLimitedCred);

    const result = await execute({
      tenantId: "tenant_test",
      roleId: "role_limited",
      dataSourceId: "ds_test",
      query: {
        kind: "sql",
        sql: "SELECT id, name FROM public.allowed_table ORDER BY id",
      },
    });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveProperty("name");
    expect(result.truncated).toBe(false);
  });

  it("rejects SELECT on a non-granted table at the source (L2 backstop)", async () => {
    _clearConnectorCache();
    setupWithTenantMock(encryptedLimitedCred);

    await expect(
      execute({
        tenantId: "tenant_test",
        roleId: "role_limited",
        dataSourceId: "ds_test",
        query: {
          kind: "sql",
          sql: "SELECT secret FROM public.restricted_table",
        },
      }),
    ).rejects.toBeInstanceOf(ConnectorDataSourceError);
  });

  it("error from restricted-table query does not expose credential fields", async () => {
    _clearConnectorCache();
    setupWithTenantMock(encryptedLimitedCred);

    let errorMsg = "";
    try {
      await execute({
        tenantId: "tenant_test",
        roleId: "role_limited",
        dataSourceId: "ds_test",
        query: {
          kind: "sql",
          sql: "SELECT secret FROM public.restricted_table",
        },
      });
    } catch (err) {
      errorMsg = (err as Error).message;
    }

    expect(errorMsg).not.toContain("limited_pass");
    expect(errorMsg).not.toContain("limited_role");
    expect(errorMsg.length).toBeGreaterThan(0);
  });
});
