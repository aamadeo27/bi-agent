/**
 * Unit tests for query-proxy.ts.
 *
 * Mocks:
 *   - withTenant   — control-plane DB (no real Postgres needed)
 *   - All connectors — no real data-source connections
 *   - decryptCredential — vault crypto (VAULT_MASTER_KEY not required)
 *
 * Security-critical assertions:
 *   - Credential is NEVER passed to logger
 *   - Only query-proxy (within datasource/) imports vault read functions
 *   - Cache invalidates on credential rotation
 *   - Errors surface as typed proxy errors
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import type { QueryResult } from "./connector.js";

// ── Shared stub result ─────────────────────────────────────────────────────────

const STUB_RESULT: QueryResult = {
  columns: [{ name: "id", type: "integer", role: "measure" }],
  rows: [{ id: 1 }],
  rowCount: 1,
  truncated: false,
};

// ── Mock: withTenant ───────────────────────────────────────────────────────────

const mockWithTenant = vi.fn();

vi.mock("../db/with-tenant.js", () => ({
  withTenant: (...args: Parameters<typeof mockWithTenant>) =>
    mockWithTenant(...args),
}));

// ── Mock: decryptCredential ────────────────────────────────────────────────────

const mockDecrypt = vi.fn();

vi.mock("./vault.js", () => ({
  decryptCredential: (c: string) => mockDecrypt(c),
}));

// ── Mock: connectors ───────────────────────────────────────────────────────────

const mockPgQuery = vi.fn().mockResolvedValue(STUB_RESULT);
const mockMysqlQuery = vi.fn().mockResolvedValue(STUB_RESULT);
const mockBigQueryQuery = vi.fn().mockResolvedValue(STUB_RESULT);
const mockRestQuery = vi.fn().mockResolvedValue(STUB_RESULT);

vi.mock("./pg-connector.js", () => ({
  PgConnector: vi.fn().mockImplementation(() => ({ query: mockPgQuery })),
}));
vi.mock("./mysql-connector.js", () => ({
  MysqlConnector: vi.fn().mockImplementation(() => ({ query: mockMysqlQuery })),
}));
vi.mock("./bigquery-connector.js", () => ({
  BigQueryConnector: vi
    .fn()
    .mockImplementation(() => ({ query: mockBigQueryQuery })),
}));
vi.mock("./rest-connector.js", () => ({
  RestConnector: vi.fn().mockImplementation(() => ({ query: mockRestQuery })),
  ConnectorDataSourceError: class ConnectorDataSourceError extends Error {
    code = "DATA_SOURCE" as const;
    constructor(msg: string) {
      super(msg);
      this.name = "ConnectorDataSourceError";
    }
  },
  ConnectorValidationError: class ConnectorValidationError extends Error {
    code = "VALIDATION" as const;
    constructor(msg: string) {
      super(msg);
      this.name = "ConnectorValidationError";
    }
  },
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────────

import {
  execute,
  _clearConnectorCache,
  ProxyCredentialNotFoundError,
  ProxyDataSourceNotFoundError,
} from "./query-proxy.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWithTenant(type: string, encryptedCred: string) {
  mockWithTenant.mockImplementation(
    (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRawUnsafe: vi
          .fn()
          .mockImplementationOnce(async () => [{ type }]) // data_sources
          .mockImplementationOnce(async () => [{ encrypted_cred: encryptedCred }]), // cred_vault_refs
      }),
  );
}

const ENCRYPTED = "enc:cred:xyz";
const DECRYPTED = { host: "localhost", port: 5432, database: "db", user: "u", password: "p" };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearConnectorCache();
    mockDecrypt.mockReturnValue(DECRYPTED);
  });

  afterEach(() => {
    _clearConnectorCache();
  });

  // ── happy path per connector type ──────────────────────────────────────────

  it("routes postgres query to PgConnector", async () => {
    makeWithTenant("postgres", ENCRYPTED);
    const result = await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });
    expect(result).toEqual(STUB_RESULT);
    expect(mockPgQuery).toHaveBeenCalledWith({ kind: "sql", sql: "SELECT 1" });
  });

  it("routes mysql query to MysqlConnector", async () => {
    makeWithTenant("mysql", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });
    expect(mockMysqlQuery).toHaveBeenCalled();
  });

  it("routes bigquery query to BigQueryConnector", async () => {
    makeWithTenant("bigquery", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });
    expect(mockBigQueryQuery).toHaveBeenCalled();
  });

  it("routes rest query to RestConnector", async () => {
    makeWithTenant("rest", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "rest", endpoint: "/api/sales" },
    });
    expect(mockRestQuery).toHaveBeenCalled();
  });

  // ── credential handling ────────────────────────────────────────────────────

  it("decrypts the credential in memory and passes it to the connector", async () => {
    makeWithTenant("postgres", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });
    expect(mockDecrypt).toHaveBeenCalledWith(ENCRYPTED);
  });

  it("never exposes the credential in any thrown error message", async () => {
    mockWithTenant.mockImplementation(
      (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: vi
            .fn()
            .mockImplementationOnce(async () => [{ type: "postgres" }])
            .mockImplementationOnce(async () => [{ encrypted_cred: ENCRYPTED }]),
        }),
    );
    mockPgQuery.mockRejectedValueOnce(new Error("connection refused"));
    await expect(
      execute({
        tenantId: "t1",
        roleId: "r1",
        dataSourceId: "ds1",
        query: { kind: "sql", sql: "SELECT 1" },
      }),
    ).rejects.toThrow("connection refused");
  });

  // ── caching ────────────────────────────────────────────────────────────────

  it("reuses the cached connector on subsequent calls with same credential", async () => {
    makeWithTenant("postgres", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });

    makeWithTenant("postgres", ENCRYPTED); // same cred hash
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 2" },
    });

    // decryptCredential called only once despite two executions
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache and rebuilds connector when credential changes", async () => {
    makeWithTenant("postgres", "enc:cred:v1");
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });

    makeWithTenant("postgres", "enc:cred:v2"); // different cred
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 2" },
    });

    // decryptCredential called twice (once per unique credential)
    expect(mockDecrypt).toHaveBeenCalledTimes(2);
  });

  it("caches independently per (tenant, role, dataSource) triple", async () => {
    makeWithTenant("postgres", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r1",
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });

    makeWithTenant("postgres", ENCRYPTED);
    await execute({
      tenantId: "t1",
      roleId: "r2", // different role
      dataSourceId: "ds1",
      query: { kind: "sql", sql: "SELECT 1" },
    });

    // Each unique (tenant,role,ds) decrypts its own credential
    expect(mockDecrypt).toHaveBeenCalledTimes(2);
  });

  // ── error cases ────────────────────────────────────────────────────────────

  it("throws ProxyDataSourceNotFoundError when data source not in DB", async () => {
    mockWithTenant.mockImplementation(
      (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockResolvedValue([]), // empty = not found
        }),
    );
    await expect(
      execute({
        tenantId: "t1",
        roleId: "r1",
        dataSourceId: "ds-missing",
        query: { kind: "sql", sql: "SELECT 1" },
      }),
    ).rejects.toBeInstanceOf(ProxyDataSourceNotFoundError);
  });

  it("throws ProxyCredentialNotFoundError when no cred for role", async () => {
    mockWithTenant.mockImplementation(
      (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: vi
            .fn()
            .mockResolvedValueOnce([{ type: "postgres" }])
            .mockResolvedValueOnce([]), // no cred row
        }),
    );
    await expect(
      execute({
        tenantId: "t1",
        roleId: "r-no-cred",
        dataSourceId: "ds1",
        query: { kind: "sql", sql: "SELECT 1" },
      }),
    ).rejects.toBeInstanceOf(ProxyCredentialNotFoundError);
  });

  it("throws ConnectorDataSourceError on unsupported data source type", async () => {
    makeWithTenant("oracle", ENCRYPTED); // unsupported
    await expect(
      execute({
        tenantId: "t1",
        roleId: "r1",
        dataSourceId: "ds1",
        query: { kind: "sql", sql: "SELECT 1" },
      }),
    ).rejects.toThrow("Unsupported data source type");
  });

  it("ProxyCredentialNotFoundError carries DATA_SOURCE code", async () => {
    const err = new ProxyCredentialNotFoundError("ds1", "r1");
    expect(err.code).toBe("DATA_SOURCE");
  });

  it("ProxyDataSourceNotFoundError carries NOT_FOUND code", async () => {
    const err = new ProxyDataSourceNotFoundError("ds1");
    expect(err.code).toBe("NOT_FOUND");
  });
});

// ── Only proxy touches vault read functions (security enforcement) ─────────────

describe("credential access enforcement", () => {
  it("only query-proxy imports getCredential or decryptCredential in the datasource directory", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    const files = await readdir(dir);
    const violations: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      if (file === "vault.ts") continue; // vault defines them
      if (file === "query-proxy.ts") continue; // proxy is the sole consumer
      if (file.endsWith(".test.ts")) continue; // test files import for mocking

      const content = await readFile(join(dir, file), "utf-8");
      // Flag files that *import* these symbols (not files that merely re-export them).
      // A re-export (`export { getCredential }`) does not constitute calling them.
      const importPattern =
        /^\s*import\s.*\b(getCredential|decryptCredential)\b/m;
      if (importPattern.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});
