/**
 * Integration tests for PgConnector — spins up a real PostgreSQL 16 instance
 * via Testcontainers. Requires Docker.
 *
 * Skipped when SKIP_DB_INTEGRATION_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PgConnector } from "./pg-connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";

const skip = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";

describe.skipIf(skip)("PgConnector (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let connector: PgConnector;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("test_db")
      .withUsername("test_user")
      .withPassword("test_pass")
      .start();

    const uri = container.getConnectionUri();
    const url = new URL(uri);
    connector = new PgConnector(
      {
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        user: url.username,
        password: decodeURIComponent(url.password),
        ssl: false,
      },
      { maxRows: 10, statementTimeoutMs: 5_000 },
    );

    // Seed test data
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: uri });
    await pool.query(`
      CREATE TABLE sales (
        id SERIAL PRIMARY KEY,
        region TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        sale_date DATE NOT NULL
      )
    `);
    for (let i = 1; i <= 15; i++) {
      await pool.query(
        "INSERT INTO sales (region, amount, sale_date) VALUES ($1, $2, $3)",
        [`region_${i % 3}`, i * 10.5, `2024-0${(i % 9) + 1}-01`],
      );
    }
    await pool.end();
  }, 90_000);

  afterAll(async () => {
    await connector.end();
    await container.stop();
  }, 30_000);

  // ── testConnection ──────────────────────────────────────────────────────────

  it("testConnection resolves on valid credentials", async () => {
    await expect(connector.testConnection()).resolves.toBeUndefined();
  });

  it("testConnection throws ConnectorDataSourceError on bad host", async () => {
    const bad = new PgConnector({
      host: "127.0.0.1",
      port: 1,
      database: "none",
      user: "none",
      password: "none",
    });
    await expect(bad.testConnection()).rejects.toBeInstanceOf(
      ConnectorDataSourceError,
    );
    await bad.end();
  });

  // ── introspect ──────────────────────────────────────────────────────────────

  it("introspect returns schema tree with sales table", async () => {
    const tree = await connector.introspect("ds-1");
    expect(tree.dataSourceId).toBe("ds-1");
    const pub = tree.schemas.find((s) => s.name === "public");
    expect(pub).toBeDefined();
    const salesTable = pub!.tables.find((t) => t.name === "sales");
    expect(salesTable).toBeDefined();
    const colNames = salesTable!.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("region");
    expect(colNames).toContain("amount");
    expect(colNames).toContain("sale_date");
  });

  it("introspect maps numeric column to 'number' type", async () => {
    const tree = await connector.introspect("ds-2");
    const pub = tree.schemas.find((s) => s.name === "public")!;
    const sales = pub.tables.find((t) => t.name === "sales")!;
    const amountCol = sales.columns.find((c) => c.name === "amount");
    expect(amountCol?.type).toBe("number");
  });

  it("introspect maps date column to 'date' type", async () => {
    const tree = await connector.introspect("ds-3");
    const pub = tree.schemas.find((s) => s.name === "public")!;
    const sales = pub.tables.find((t) => t.name === "sales")!;
    const dateCol = sales.columns.find((c) => c.name === "sale_date");
    expect(dateCol?.type).toBe("date");
  });

  // ── query ───────────────────────────────────────────────────────────────────

  it("query returns expected columns and rows", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT region, amount FROM sales ORDER BY id",
    });
    expect(result.columns.map((c) => c.name)).toEqual(["region", "amount"]);
    expect(result.rows.length).toBeGreaterThan(0);
    // 'amount' is numeric → measure role
    const amountCol = result.columns.find((c) => c.name === "amount");
    expect(amountCol?.role).toBe("measure");
    // 'region' is string → dimension role
    const regionCol = result.columns.find((c) => c.name === "region");
    expect(regionCol?.role).toBe("dimension");
  });

  it("query enforces row cap and sets truncated=true", async () => {
    // maxRows=10, 15 rows in table → should truncate
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT * FROM sales",
    });
    expect(result.rows.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(10); // rows returned (truncated=true signals more exist)
  });

  it("query with fewer rows than cap sets truncated=false", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT * FROM sales LIMIT 3",
    });
    expect(result.rows.length).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("query normalizes null values to null", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT NULL::text AS empty_col",
    });
    expect(result.rows[0]).toEqual({ empty_col: null });
  });

  it("query with parameters works correctly", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT region, amount FROM sales WHERE region = $1",
      params: ["region_0"],
    });
    expect(result.rows.every((r) => r["region"] === "region_0")).toBe(true);
  });

  it("query throws ConnectorDataSourceError on invalid SQL", async () => {
    await expect(
      connector.query({ kind: "sql", sql: "SELECT * FROM nonexistent_table" }),
    ).rejects.toBeInstanceOf(ConnectorDataSourceError);
  });
});
