/**
 * Integration tests for MysqlConnector — spins up a real MySQL 8 instance
 * via Testcontainers. Requires Docker.
 *
 * Skipped when SKIP_DB_INTEGRATION_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySqlContainer } from "@testcontainers/mysql";
import type { StartedMySqlContainer } from "@testcontainers/mysql";
import { MysqlConnector } from "./mysql-connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";

const skip = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";

describe.skipIf(skip)("MysqlConnector (integration)", () => {
  let container: StartedMySqlContainer;
  let connector: MysqlConnector;

  beforeAll(async () => {
    container = await new MySqlContainer("mysql:8")
      .withDatabase("test_db")
      .withUsername("test_user")
      .withUserPassword("test_pass")
      .withRootPassword("root_pass")
      .start();

    connector = new MysqlConnector(
      {
        host: container.getHost(),
        port: container.getPort(),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getUserPassword(),
        ssl: false,
      },
      { maxRows: 10, statementTimeoutMs: 5_000 },
    );

    // Seed test data
    const { createPool } = await import("mysql2/promise");
    const pool = createPool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: "root",
      password: container.getRootPassword(),
    });
    await pool.query(`
      CREATE TABLE products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at DATETIME NOT NULL
      )
    `);
    for (let i = 1; i <= 15; i++) {
      await pool.query(
        "INSERT INTO products (name, price, created_at) VALUES (?, ?, ?)",
        [`product_${i}`, i * 9.99, `2024-0${(i % 9) + 1}-01 00:00:00`],
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
    const bad = new MysqlConnector({
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

  it("introspect returns schema tree with products table", async () => {
    const tree = await connector.introspect("ds-mysql-1");
    expect(tree.dataSourceId).toBe("ds-mysql-1");
    expect(tree.schemas.length).toBe(1);
    const schema = tree.schemas[0]!;
    expect(schema.name).toBe("test_db");
    const productsTable = schema.tables.find((t) => t.name === "products");
    expect(productsTable).toBeDefined();
    const colNames = productsTable!.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
    expect(colNames).toContain("price");
    expect(colNames).toContain("created_at");
  });

  it("introspect maps decimal column to 'number' type", async () => {
    const tree = await connector.introspect("ds-mysql-2");
    const schema = tree.schemas[0]!;
    const products = schema.tables.find((t) => t.name === "products")!;
    const priceCol = products.columns.find((c) => c.name === "price");
    expect(priceCol?.type).toBe("number");
  });

  it("introspect maps datetime column to 'datetime' type", async () => {
    const tree = await connector.introspect("ds-mysql-3");
    const schema = tree.schemas[0]!;
    const products = schema.tables.find((t) => t.name === "products")!;
    const dtCol = products.columns.find((c) => c.name === "created_at");
    expect(dtCol?.type).toBe("datetime");
  });

  // ── query ───────────────────────────────────────────────────────────────────

  it("query returns expected columns and rows", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT name, price FROM products ORDER BY id",
    });
    expect(result.columns.map((c) => c.name)).toEqual(["name", "price"]);
    expect(result.rows.length).toBeGreaterThan(0);
    const priceCol = result.columns.find((c) => c.name === "price");
    expect(priceCol?.role).toBe("measure");
    const nameCol = result.columns.find((c) => c.name === "name");
    expect(nameCol?.role).toBe("dimension");
  });

  it("query enforces row cap and sets truncated=true", async () => {
    // maxRows=10, 15 rows in table → should truncate
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT * FROM products",
    });
    expect(result.rows.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(11); // fetched cap+1
  });

  it("query with fewer rows than cap sets truncated=false", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT * FROM products LIMIT 3",
    });
    expect(result.rows.length).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("query with parameters works correctly", async () => {
    const result = await connector.query({
      kind: "sql",
      sql: "SELECT name, price FROM products WHERE name = ?",
      params: ["product_1"],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!["name"]).toBe("product_1");
  });

  it("query throws ConnectorDataSourceError on invalid SQL", async () => {
    await expect(
      connector.query({
        kind: "sql",
        sql: "SELECT * FROM nonexistent_table",
      }),
    ).rejects.toBeInstanceOf(ConnectorDataSourceError);
  });
});
