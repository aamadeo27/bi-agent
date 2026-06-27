/**
 * Unit tests for BigQueryConnector — BigQuery client is fully mocked.
 * No network calls; no Docker required.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { BigQueryConnector } from "./bigquery-connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";

// ── Mock @google-cloud/bigquery ────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockGetDatasets = vi.fn();
const mockGetTables = vi.fn();
const mockGetMetadata = vi.fn();

vi.mock("@google-cloud/bigquery", () => {
  return {
    BigQuery: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      getDatasets: mockGetDatasets,
    })),
  };
});

// ── Fixture credential ─────────────────────────────────────────────────────────

const cred = {
  projectId: "test-project",
  credentials: {
    client_email: "sa@test.iam.gserviceaccount.com",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
  },
  location: "US",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConnector(opts?: { maxRows?: number; queryTimeoutMs?: number }) {
  return new BigQueryConnector(cred, opts);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("BigQueryConnector.testConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when query succeeds", async () => {
    mockQuery.mockResolvedValueOnce([[{ ok: 1 }]]);
    const connector = makeConnector();
    await expect(connector.testConnection()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("throws ConnectorDataSourceError when query rejects", async () => {
    mockQuery.mockRejectedValueOnce(new Error("auth failure"));
    const connector = makeConnector();
    await expect(connector.testConnection()).rejects.toBeInstanceOf(
      ConnectorDataSourceError,
    );
  });

  it("wraps error message from underlying failure", async () => {
    mockQuery.mockRejectedValueOnce(new Error("network timeout"));
    const connector = makeConnector();
    await expect(connector.testConnection()).rejects.toThrow("network timeout");
  });
});

describe("BigQueryConnector.introspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns schema tree from BQ datasets/tables/fields", async () => {
    mockGetTables.mockResolvedValueOnce([
      [
        {
          id: "orders",
          getMetadata: mockGetMetadata.mockResolvedValueOnce([
            {
              schema: {
                fields: [
                  { name: "order_id", type: "INT64" },
                  { name: "total", type: "NUMERIC" },
                  { name: "created_at", type: "DATETIME" },
                ],
              },
            },
          ]),
        },
      ],
    ]);
    mockGetDatasets.mockResolvedValueOnce([
      [
        {
          id: "analytics",
          getTables: mockGetTables,
        },
      ],
    ]);

    const connector = makeConnector();
    const tree = await connector.introspect("bq-ds-1");

    expect(tree.dataSourceId).toBe("bq-ds-1");
    expect(tree.schemas).toHaveLength(1);
    expect(tree.schemas[0]!.name).toBe("analytics");
    const orders = tree.schemas[0]!.tables.find((t) => t.name === "orders");
    expect(orders).toBeDefined();
    expect(orders!.columns).toEqual([
      { name: "order_id", type: "integer" },
      { name: "total", type: "number" },
      { name: "created_at", type: "datetime" },
    ]);
  });

  it("returns empty schemas when no datasets exist", async () => {
    mockGetDatasets.mockResolvedValueOnce([[]]);
    const connector = makeConnector();
    const tree = await connector.introspect("bq-empty");
    expect(tree.schemas).toHaveLength(0);
  });

  it("throws ConnectorDataSourceError when getDatasets rejects", async () => {
    mockGetDatasets.mockRejectedValueOnce(new Error("permission denied"));
    const connector = makeConnector();
    await expect(connector.introspect("bq-ds-err")).rejects.toBeInstanceOf(
      ConnectorDataSourceError,
    );
  });
});

describe("BigQueryConnector.query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized columns and rows", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        { product: "widget", revenue: 1200.5, sale_date: new Date("2024-03-15T10:30:00Z") },
      ],
    ]);
    const connector = makeConnector();
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT product, revenue, sale_date FROM sales",
    });

    expect(result.columns.map((c) => c.name)).toEqual([
      "product",
      "revenue",
      "sale_date",
    ]);
    const revenueCol = result.columns.find((c) => c.name === "revenue");
    expect(revenueCol?.type).toBe("number");
    expect(revenueCol?.role).toBe("measure");
    const productCol = result.columns.find((c) => c.name === "product");
    expect(productCol?.role).toBe("dimension");
    const saleDateCol = result.columns.find((c) => c.name === "sale_date");
    expect(saleDateCol?.type).toBe("datetime");
    expect(saleDateCol?.role).toBe("time");

    expect(result.rows[0]!["sale_date"]).toMatch(/^2024-03-15T10:30/);
    expect(result.truncated).toBe(false);
  });

  it("enforces row cap and sets truncated=true", async () => {
    // maxRows=3, return 4 rows (cap+1)
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, val: i }));
    mockQuery.mockResolvedValueOnce([rows]);

    const connector = makeConnector({ maxRows: 3 });
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT id, val FROM t",
    });

    expect(result.rows.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(3); // rows returned (truncated=true signals more exist)
  });

  it("sets truncated=false when rows <= cap", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockQuery.mockResolvedValueOnce([rows]);

    const connector = makeConnector({ maxRows: 10 });
    const result = await connector.query({ kind: "sql", sql: "SELECT id FROM t" });

    expect(result.truncated).toBe(false);
    expect(result.rowCount).toBe(2);
  });

  it("wraps the original SQL in a subquery with LIMIT", async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const connector = makeConnector({ maxRows: 5 });
    await connector.query({ kind: "sql", sql: "SELECT * FROM tbl" });

    const callArg = (mockQuery as MockInstance).mock.calls[0]?.[0] as {
      query: string;
    };
    expect(callArg.query).toMatch(/SELECT \* FROM \(SELECT \* FROM tbl\) AS _q LIMIT 6/);
  });

  it("passes params to BigQuery query call", async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const connector = makeConnector();
    await connector.query({
      kind: "sql",
      sql: "SELECT * FROM t WHERE id = @id",
      params: [42],
    });

    const callArg = (mockQuery as MockInstance).mock.calls[0]?.[0] as {
      params: unknown[];
    };
    expect(callArg.params).toEqual([42]);
  });

  it("normalizes null values to null", async () => {
    mockQuery.mockResolvedValueOnce([[{ col: null }]]);
    const connector = makeConnector();
    const result = await connector.query({ kind: "sql", sql: "SELECT NULL AS col" });
    expect(result.rows[0]!["col"]).toBeNull();
  });

  it("normalizes boolean values to string", async () => {
    mockQuery.mockResolvedValueOnce([[{ flag: true }, { flag: false }]]);
    const connector = makeConnector();
    const result = await connector.query({ kind: "sql", sql: "SELECT flag FROM t" });
    expect(result.rows[0]!["flag"]).toBe("true");
    expect(result.rows[1]!["flag"]).toBe("false");
  });

  it("throws ConnectorDataSourceError when BQ query rejects", async () => {
    mockQuery.mockRejectedValueOnce(new Error("quota exceeded"));
    const connector = makeConnector();
    await expect(
      connector.query({ kind: "sql", sql: "SELECT 1" }),
    ).rejects.toBeInstanceOf(ConnectorDataSourceError);
  });

  it("passes timeoutMs from SqlQuery as jobTimeoutMs", async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const connector = makeConnector();
    await connector.query({ kind: "sql", sql: "SELECT 1", timeoutMs: 12_000 });

    const callArg = (mockQuery as MockInstance).mock.calls[0]?.[0] as {
      jobTimeoutMs: number;
    };
    expect(callArg.jobTimeoutMs).toBe(12_000);
  });

  it("returns empty columns and rows when result is empty", async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const connector = makeConnector();
    const result = await connector.query({ kind: "sql", sql: "SELECT 1 WHERE false" });
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.rowCount).toBe(0);
  });
});

// ── sql-shared type inference unit tests ───────────────────────────────────────

describe("mapBigQueryType", async () => {
  const { mapBigQueryType } = await import("./sql-shared.js");

  it.each([
    ["INT64", "integer"],
    ["INTEGER", "integer"],
    ["FLOAT64", "number"],
    ["NUMERIC", "number"],
    ["BOOL", "boolean"],
    ["BOOLEAN", "boolean"],
    ["DATETIME", "datetime"],
    ["TIMESTAMP", "datetime"],
    ["DATE", "date"],
    ["STRING", "string"],
    ["BYTES", "string"],
    ["RECORD", "string"],
  ])("maps BQ type %s to %s", (bqType, expected) => {
    expect(mapBigQueryType(bqType)).toBe(expected);
  });
});

describe("inferSqlType", async () => {
  const { inferSqlType } = await import("./sql-shared.js");

  it("maps null to string", () => expect(inferSqlType(null)).toBe("string"));
  it("maps boolean to boolean", () => expect(inferSqlType(true)).toBe("boolean"));
  it("maps integer number to integer", () => expect(inferSqlType(42)).toBe("integer"));
  it("maps float to number", () => expect(inferSqlType(3.14)).toBe("number"));
  it("maps Date with time to datetime", () =>
    expect(inferSqlType(new Date("2024-01-15T10:30:00Z"))).toBe("datetime"));
  it("maps midnight Date to date", () =>
    expect(inferSqlType(new Date("2024-01-15T00:00:00.000Z"))).toBe("date"));
  it("maps ISO datetime string to datetime", () =>
    expect(inferSqlType("2024-01-15T10:30:00")).toBe("datetime"));
  it("maps ISO date string to date", () =>
    expect(inferSqlType("2024-01-15")).toBe("date"));
  it("maps bigint to integer", () => expect(inferSqlType(BigInt(100))).toBe("integer"));
  it("maps plain string to string", () => expect(inferSqlType("hello")).toBe("string"));
});
