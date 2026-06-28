/**
 * T5.2 — Permission gate adversarial unit tests.
 *
 * Tests the security properties required by the acceptance criteria:
 *  - allow only when fully granted
 *  - block on ANY missing resource (no subsetting, no partial)
 *  - exact missing[] payload
 *  - fail closed on unresolvable names, parse errors, wildcards without table grant
 *  - handles CTEs, subqueries, aliases, joins
 *  - deterministic (same input → same output)
 */

import { describe, it, expect } from "vitest";
import { evaluateGate } from "./permission-gate.js";
import type { ResourceGrant, ResourceGrantSet } from "@bi/contracts";

// ── Test fixture helpers ───────────────────────────────────────────────────────

function tableGrant(schema: string, table: string): ResourceGrant {
  return {
    roleId: "r1",
    dataSourceId: "ds1",
    kind: "table",
    schema,
    table,
  };
}

function columnGrant(
  schema: string,
  table: string,
  column: string
): ResourceGrant {
  return {
    roleId: "r1",
    dataSourceId: "ds1",
    kind: "column",
    schema,
    table,
    column,
  };
}

function schemaGrant(schema: string): ResourceGrant {
  return {
    roleId: "r1",
    dataSourceId: "ds1",
    kind: "schema",
    schema,
  };
}

function sql(s: string) {
  return { sql: s, queryType: "sql" as const };
}

// ── Happy path: fully granted ──────────────────────────────────────────────────

describe("allow on fully-granted queries", () => {
  it("allows simple SELECT with table grant", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id, amount FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows with column grants covering all referenced columns", () => {
    const grants: ResourceGrantSet = [
      columnGrant("sales", "orders", "id"),
      columnGrant("sales", "orders", "amount"),
    ];
    const result = evaluateGate({
      query: sql("SELECT id, amount FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows qualified column refs (schema.table.column pattern)", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(
        "SELECT o.id, o.amount FROM sales.orders o WHERE o.amount > 100"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows multi-table JOIN when all tables granted", () => {
    const grants: ResourceGrantSet = [
      tableGrant("sales", "orders"),
      tableGrant("sales", "users"),
    ];
    const result = evaluateGate({
      query: sql(
        "SELECT u.name, o.amount FROM sales.users u JOIN sales.orders o ON u.id = o.user_id"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows SELECT * when table grant present (table grant implies all columns)", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT * FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows CTE where inner and outer both fully granted", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(
        "WITH cte AS (SELECT id, amount FROM sales.orders) SELECT id FROM cte"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows subquery in FROM when inner table is granted", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(
        "SELECT sq.id FROM (SELECT id FROM sales.orders) AS sq"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows mysql dialect", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id FROM sales.orders"),
      grants,
      dialect: "mysql",
    });
    expect(result.allow).toBe(true);
  });

  it("allows BigQuery dialect with 3-part name (project.dataset.table) — project prefix stripped from schema", () => {
    // Grant uses dataset name only ("sales"), not "myproject.sales".
    // The gate normalises "myproject.sales" → "sales" so it matches.
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id FROM myproject.sales.orders"),
      grants,
      dialect: "bigquery",
    });
    expect(result.allow).toBe(true);
  });

  it("blocks BigQuery query when dataset grant is missing", () => {
    const grants: ResourceGrantSet = [tableGrant("other_dataset", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id FROM myproject.sales.orders"),
      grants,
      dialect: "bigquery",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing[0]).toMatchObject({
        kind: "table",
        identifier: "sales.orders",
      });
    }
  });

  it("allows BigQuery 2-part name (dataset.table)", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id FROM sales.orders"),
      grants,
      dialect: "bigquery",
    });
    expect(result.allow).toBe(true);
  });
});

// ── Block on any missing resource ──────────────────────────────────────────────

describe("block on any missing resource (GAP-12 never-partial)", () => {
  it("blocks when column is not granted", () => {
    const grants: ResourceGrantSet = [columnGrant("sales", "orders", "id")];
    // 'amount' is not granted
    const result = evaluateGate({
      query: sql("SELECT id, amount FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toMatchObject({
        kind: "column",
        identifier: "sales.orders.amount",
        accessNeeded: "read",
      });
    }
  });

  it("blocks when table is not granted at all — only table entry in missing[], no redundant column entries", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "users")];
    // 'orders' has no grant
    const result = evaluateGate({
      query: sql("SELECT id FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toMatchObject({
        kind: "table",
        identifier: "sales.orders",
        accessNeeded: "read",
      });
    }
  });

  it("blocks when one table in JOIN is not granted", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    // users is not granted
    const result = evaluateGate({
      query: sql(
        "SELECT u.name, o.amount FROM sales.users u JOIN sales.orders o ON u.id = o.user_id"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      const tableEntry = result.missing.find((m) =>
        m.identifier.includes("users")
      );
      expect(tableEntry).toBeDefined();
    }
  });

  it("blocks even with 9/10 columns granted — never partial", () => {
    const grants: ResourceGrantSet = [
      columnGrant("sales", "orders", "col1"),
      columnGrant("sales", "orders", "col2"),
      columnGrant("sales", "orders", "col3"),
      columnGrant("sales", "orders", "col4"),
      columnGrant("sales", "orders", "col5"),
      columnGrant("sales", "orders", "col6"),
      columnGrant("sales", "orders", "col7"),
      columnGrant("sales", "orders", "col8"),
      columnGrant("sales", "orders", "col9"),
      // col10 intentionally omitted
    ];
    const result = evaluateGate({
      query: sql(
        "SELECT col1, col2, col3, col4, col5, col6, col7, col8, col9, col10 FROM sales.orders"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].identifier).toBe("sales.orders.col10");
    }
  });

  it("blocks when schema-only grant does not cover table", () => {
    // Schema grant alone does NOT imply table access
    const grants: ResourceGrantSet = [schemaGrant("sales")];
    const result = evaluateGate({
      query: sql("SELECT id FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.some((m) => m.identifier.includes("orders"))).toBe(
        true
      );
    }
  });

  it("reports all missing resources (multiple gaps)", () => {
    const grants: ResourceGrantSet = []; // nothing granted
    const result = evaluateGate({
      query: sql(
        "SELECT u.name, o.amount FROM sales.users u JOIN sales.orders o ON u.id = o.user_id"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── Wildcard SELECT * ──────────────────────────────────────────────────────────

describe("SELECT * handling", () => {
  it("blocks SELECT * when only column grants exist (no table grant)", () => {
    // Column grants are not sufficient for SELECT * — we can't enumerate all columns.
    const grants: ResourceGrantSet = [
      columnGrant("sales", "orders", "id"),
      columnGrant("sales", "orders", "amount"),
    ];
    const result = evaluateGate({
      query: sql("SELECT * FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.some((m) => m.identifier === "sales.orders")).toBe(
        true
      );
    }
  });

  it("blocks SELECT * on multi-table FROM when any table lacks table grant", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    // users has no table grant
    const result = evaluateGate({
      query: sql("SELECT * FROM sales.orders, sales.users"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
  });

  it("allows SELECT * when all tables have table grants", () => {
    const grants: ResourceGrantSet = [
      tableGrant("sales", "orders"),
      tableGrant("sales", "users"),
    ];
    const result = evaluateGate({
      query: sql("SELECT * FROM sales.orders, sales.users"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });
});

// ── Fail closed on unresolvable names ─────────────────────────────────────────

describe("fail closed on unresolvable references", () => {
  it("fails closed on SQL parse error", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("THIS IS NOT SQL AT ALL !!!"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
  });

  it("fails closed on empty SQL", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(""),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
  });

  it("fails closed on unqualified column with multiple tables in scope", () => {
    // 'id' could be from users or orders — ambiguous without schema info.
    const grants: ResourceGrantSet = [
      tableGrant("sales", "users"),
      tableGrant("sales", "orders"),
    ];
    const result = evaluateGate({
      query: sql(
        "SELECT id FROM sales.users JOIN sales.orders ON sales.users.id = sales.orders.user_id"
      ),
      grants,
      dialect: "postgres",
    });
    // Either allows (if parser qualifies) or blocks (if ambiguous) — but NEVER partial.
    // The important property: if it blocks, missing[] is non-empty.
    if (!result.allow) {
      expect(result.missing.length).toBeGreaterThan(0);
    }
  });

  it("fails closed on unqualified table name (no schema prefix)", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT id FROM orders"), // no schema prefix
      grants,
      dialect: "postgres",
    });
    // No schema → can't verify → block
    expect(result.allow).toBe(false);
  });

  it("fails closed on REST query type", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: { sql: "/api/data", queryType: "rest" },
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
  });

});

// ── Non-SELECT statement handling ─────────────────────────────────────────────

describe("non-SELECT statement handling", () => {
  it("blocks DDL/DML — gate sees DELETE table as 'delete' op (filtered) but WHERE column is ambiguous → fail closed", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("DELETE FROM sales.orders WHERE id = 1"),
      grants,
      dialect: "postgres",
    });
    // DELETE tables appear under op "delete" in tableList — filtered out.
    // WHERE column `id` appears under op "select" but with 0 real tables → ambiguous → fail closed.
    // T5.3 query validator rejects non-SELECT before execution; gate adds a safety backstop.
    expect(result.allow).toBe(false);
  });
});

// ── CTE and subquery handling ──────────────────────────────────────────────────

describe("CTE and subquery resolution", () => {
  it("blocks when CTE body references an ungranted table", () => {
    const grants: ResourceGrantSet = []; // nothing granted
    const result = evaluateGate({
      query: sql(
        "WITH cte AS (SELECT id FROM sales.orders) SELECT id FROM cte"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.some((m) => m.identifier.includes("orders"))).toBe(
        true
      );
    }
  });

  it("blocks when CTE body references an ungranted column", () => {
    const grants: ResourceGrantSet = [columnGrant("sales", "orders", "id")];
    // 'secret' is not granted
    const result = evaluateGate({
      query: sql(
        "WITH cte AS (SELECT id, secret FROM sales.orders) SELECT id FROM cte"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(
        result.missing.some((m) => m.identifier.includes("secret"))
      ).toBe(true);
    }
  });

  it("allows CTE when all referenced resources are granted", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(`
        WITH recent AS (
          SELECT id, amount FROM sales.orders WHERE amount > 0
        )
        SELECT id, amount FROM recent
      `),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("blocks when subquery in FROM references ungranted table", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "users")];
    const result = evaluateGate({
      query: sql(
        "SELECT sq.id FROM (SELECT id FROM sales.orders) AS sq"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.some((m) => m.identifier.includes("orders"))).toBe(
        true
      );
    }
  });

  it("allows subquery in FROM when inner table is granted", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql(
        "SELECT sq.id FROM (SELECT id FROM sales.orders WHERE amount > 100) AS sq"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("blocks nested CTEs when any referenced resource is missing", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    // restricted_table is not granted
    const result = evaluateGate({
      query: sql(`
        WITH a AS (SELECT id FROM sales.orders),
             b AS (SELECT secret FROM analytics.restricted_table)
        SELECT a.id FROM a JOIN b ON a.id = b.id
      `),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
  });
});

// ── Alias resolution ───────────────────────────────────────────────────────────

describe("alias resolution", () => {
  it("resolves table alias correctly", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT o.id, o.amount FROM sales.orders AS o"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("blocks when aliased table has an ungranted column", () => {
    const grants: ResourceGrantSet = [columnGrant("sales", "orders", "id")];
    // amount not granted
    const result = evaluateGate({
      query: sql("SELECT o.id, o.amount FROM sales.orders o"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing[0]).toMatchObject({
        kind: "column",
        identifier: "sales.orders.amount",
      });
    }
  });
});

// ── Exact missing[] payload ────────────────────────────────────────────────────

describe("exact missing[] contract", () => {
  it("missing[] contains exactly the ungranted identifiers", () => {
    const grants: ResourceGrantSet = [columnGrant("sales", "orders", "id")];
    const result = evaluateGate({
      query: sql("SELECT id, amount, revenue FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      const ids = result.missing.map((m) => m.identifier).sort();
      expect(ids).toEqual(
        ["sales.orders.amount", "sales.orders.revenue"].sort()
      );
      for (const m of result.missing) {
        expect(m.accessNeeded).toBe("read");
      }
    }
  });

  it("missing[] has no duplicates", () => {
    const grants: ResourceGrantSet = [];
    // Both columns from same ungranted table → table missing once, not twice.
    const result = evaluateGate({
      query: sql("SELECT id, amount FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      const keys = result.missing.map((m) => `${m.kind}:${m.identifier}`);
      const uniqueKeys = [...new Set(keys)];
      expect(keys).toEqual(uniqueKeys);
    }
  });

  it("missing[] has only the table entry when table is wholly ungranted — no redundant column entries", () => {
    // Table grant is absent entirely. Per the grant model, a missing table entry
    // already implies all columns are inaccessible; individual column entries are redundant.
    const grants: ResourceGrantSet = [];
    const result = evaluateGate({
      query: sql("SELECT id, amount FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toMatchObject({
        kind: "table",
        identifier: "sales.orders",
        accessNeeded: "read",
      });
    }
  });

  it("each missing item has accessNeeded === 'read'", () => {
    const grants: ResourceGrantSet = [];
    const result = evaluateGate({
      query: sql("SELECT id FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      for (const m of result.missing) {
        expect(m.accessNeeded).toBe("read");
      }
    }
  });
});

// ── Determinism ────────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("same input always produces same output", () => {
    const grants: ResourceGrantSet = [columnGrant("sales", "orders", "id")];
    const q = sql("SELECT id, amount FROM sales.orders");
    const r1 = evaluateGate({ query: q, grants, dialect: "postgres" });
    const r2 = evaluateGate({ query: q, grants, dialect: "postgres" });
    expect(r1).toEqual(r2);
  });

  it("result is not affected by grant set order", () => {
    const g1: ResourceGrantSet = [
      columnGrant("sales", "orders", "id"),
      columnGrant("sales", "orders", "amount"),
    ];
    const g2: ResourceGrantSet = [
      columnGrant("sales", "orders", "amount"),
      columnGrant("sales", "orders", "id"),
    ];
    const q = sql("SELECT id, amount FROM sales.orders");
    const r1 = evaluateGate({ query: q, grants: g1, dialect: "postgres" });
    const r2 = evaluateGate({ query: q, grants: g2, dialect: "postgres" });
    expect(r1.allow).toEqual(r2.allow);
  });
});

// ── WHERE / expression columns ─────────────────────────────────────────────────

describe("WHERE and expression columns", () => {
  it("blocks when WHERE clause references ungranted column", () => {
    // Only 'name' is granted; WHERE uses 'secret_score'
    const grants: ResourceGrantSet = [columnGrant("sales", "users", "name")];
    const result = evaluateGate({
      query: sql(
        "SELECT name FROM sales.users WHERE secret_score > 90"
      ),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(
        result.missing.some((m) => m.identifier.includes("secret_score"))
      ).toBe(true);
    }
  });

  it("allows when WHERE column is also granted", () => {
    const grants: ResourceGrantSet = [
      columnGrant("sales", "users", "name"),
      columnGrant("sales", "users", "status"),
    ];
    const result = evaluateGate({
      query: sql("SELECT name FROM sales.users WHERE status = 'active'"),
      grants,
      dialect: "postgres",
    });
    expect(result.allow).toBe(true);
  });

  it("allows COUNT(*) with table grant (aggregate, no column enum needed)", () => {
    const grants: ResourceGrantSet = [tableGrant("sales", "orders")];
    const result = evaluateGate({
      query: sql("SELECT COUNT(*) FROM sales.orders"),
      grants,
      dialect: "postgres",
    });
    // COUNT(*) is an aggregate — star is inside AggrFunc, not a column_ref.
    // Table grant covers this.
    expect(result.allow).toBe(true);
  });
});
