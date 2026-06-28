/**
 * T5.3 — Query validator adversarial unit tests.
 *
 * Covers the security properties required by the acceptance criteria:
 *   - Only SELECT passes; all blocked categories are rejected
 *   - Row cap + query-length cap enforced
 *   - Literals parameterized
 *   - REST queries validated against declared endpoint/field schema
 *   - Adversarial: multi-statement, comment-hidden, DDL/DML, oversized
 */

import { describe, it, expect } from "vitest";
import {
  validateQuery,
  DEFAULT_MAX_QUERY_LENGTH,
  DEFAULT_MAX_ROW_LIMIT,
  type ValidatedSqlQuery,
  type ValidatedRestQuery,
} from "./query-validator.js";
import type { GeneratedQuery } from "./permission-gate.js";
import type { EndpointDecl } from "../datasource/rest-connector.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function sql(s: string): GeneratedQuery {
  return { sql: s, queryType: "sql" };
}

function rest(body: object): GeneratedQuery {
  return { sql: JSON.stringify(body), queryType: "rest" };
}

const ENDPOINTS: EndpointDecl[] = [
  { path: "/api/v1/sales", fields: ["id", "amount", "region"] },
  { path: "/api/v1/users", fields: ["id", "name", "email"] },
];

const PG_OPTS = { dialect: "postgres" as const };

// ── Happy path: SELECT ─────────────────────────────────────────────────────────

describe("SQL — happy path", () => {
  it("allows a simple SELECT", () => {
    const result = validateQuery(sql("SELECT id FROM public.users LIMIT 10"), PG_OPTS);
    expect(result.ok).toBe(true);
  });

  it("allows SELECT with JOIN", () => {
    const result = validateQuery(
      sql(`SELECT u.id, o.amount
           FROM public.users u
           JOIN public.orders o ON u.id = o.user_id
           LIMIT 50`),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
  });

  it("allows SELECT with CTE", () => {
    const result = validateQuery(
      sql(`WITH ranked AS (SELECT id, amount FROM sales.orders LIMIT 100)
           SELECT * FROM ranked`),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
  });

  it("allows SELECT with subquery", () => {
    const result = validateQuery(
      sql(`SELECT * FROM (SELECT id FROM public.users) AS sub LIMIT 5`),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
  });
});

// ── Row LIMIT cap ──────────────────────────────────────────────────────────────

describe("SQL — LIMIT cap", () => {
  it("adds LIMIT when absent", () => {
    const result = validateQuery(sql("SELECT id FROM public.users"), PG_OPTS);
    expect(result.ok).toBe(true);
    const q = (result as { ok: true; query: ValidatedSqlQuery }).query;
    expect(q.sql.toLowerCase()).toMatch(/limit/);
  });

  it("clamps LIMIT above the cap", () => {
    const maxRowLimit = 500;
    const result = validateQuery(
      sql("SELECT id FROM public.users LIMIT 99999"),
      { ...PG_OPTS, maxRowLimit },
    );
    expect(result.ok).toBe(true);
    const q = (result as { ok: true; query: ValidatedSqlQuery }).query;
    expect(q.sql).toContain(String(maxRowLimit));
    expect(q.sql).not.toContain("99999");
  });

  it("preserves LIMIT below the cap", () => {
    const result = validateQuery(
      sql("SELECT id FROM public.users LIMIT 10"),
      { ...PG_OPTS, maxRowLimit: 1000 },
    );
    expect(result.ok).toBe(true);
    const q = (result as { ok: true; query: ValidatedSqlQuery }).query;
    expect(q.sql).toContain("10");
  });

  it("applies default cap of DEFAULT_MAX_ROW_LIMIT", () => {
    const result = validateQuery(sql("SELECT id FROM t"), PG_OPTS);
    expect(result.ok).toBe(true);
    const q = (result as { ok: true; query: ValidatedSqlQuery }).query;
    expect(q.sql).toContain(String(DEFAULT_MAX_ROW_LIMIT));
  });
});

// ── Query length cap ───────────────────────────────────────────────────────────

describe("SQL — query-length cap", () => {
  it("rejects a query that exceeds the length cap", () => {
    const oversized = "SELECT id FROM t -- " + "x".repeat(DEFAULT_MAX_QUERY_LENGTH);
    const result = validateQuery(sql(oversized), PG_OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/length/i);
    }
  });

  it("accepts a custom length cap", () => {
    const short = "SELECT 1";
    const result = validateQuery(sql(short), { ...PG_OPTS, maxQueryLength: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("accepts a query exactly at the length cap", () => {
    const q = "SELECT id FROM t";
    const result = validateQuery(sql(q), { ...PG_OPTS, maxQueryLength: q.length });
    expect(result.ok).toBe(true);
  });
});

// ── Empty query ────────────────────────────────────────────────────────────────

describe("SQL — empty / whitespace", () => {
  it("rejects an empty string", () => {
    const result = validateQuery(sql(""), PG_OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects whitespace-only string", () => {
    const result = validateQuery(sql("   \n\t  "), PG_OPTS);
    expect(result.ok).toBe(false);
  });
});

// ── Multi-statement ────────────────────────────────────────────────────────────

describe("SQL — multi-statement (adversarial)", () => {
  it("rejects semicolon-chained statements", () => {
    const result = validateQuery(
      sql("SELECT 1; DROP TABLE users"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/multi.?statement|semicolon/i);
    }
  });

  it("rejects trailing semicolon with extra statement", () => {
    const result = validateQuery(
      sql("SELECT id FROM t; INSERT INTO t VALUES (1)"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects three-part chain", () => {
    const result = validateQuery(
      sql("SELECT 1; SELECT 2; SELECT 3"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });
});

// ── Comment-hidden statements ──────────────────────────────────────────────────

describe("SQL — comment-hidden (adversarial)", () => {
  it("rejects DROP hidden behind line comment", () => {
    // The -- starts a comment that hides the semicolon on screen, but stripping
    // reveals the second statement.
    const result = validateQuery(
      sql("SELECT 1 --\n; DROP TABLE users"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects statement hidden in block comment", () => {
    const result = validateQuery(
      sql("SELECT 1 /* innocent */; DELETE FROM users"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects nested comment hiding injection", () => {
    const result = validateQuery(
      sql("SELECT /* DROP TABLE t; */ 1; DROP TABLE t"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });
});

// ── DDL ────────────────────────────────────────────────────────────────────────

describe("SQL — DDL (adversarial)", () => {
  it("rejects DROP TABLE", () => {
    const result = validateQuery(sql("DROP TABLE users"), PG_OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects CREATE TABLE", () => {
    const result = validateQuery(
      sql("CREATE TABLE evil (id INT)"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects ALTER TABLE", () => {
    const result = validateQuery(
      sql("ALTER TABLE users ADD COLUMN evil TEXT"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects TRUNCATE", () => {
    const result = validateQuery(sql("TRUNCATE TABLE users"), PG_OPTS);
    expect(result.ok).toBe(false);
  });
});

// ── DML ────────────────────────────────────────────────────────────────────────

describe("SQL — DML (adversarial)", () => {
  it("rejects INSERT INTO", () => {
    const result = validateQuery(
      sql("INSERT INTO users (id) VALUES (1)"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects UPDATE … SET", () => {
    const result = validateQuery(
      sql("UPDATE users SET name = 'evil' WHERE id = 1"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects DELETE FROM", () => {
    const result = validateQuery(
      sql("DELETE FROM users WHERE id = 1"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });
});

// ── File I/O ───────────────────────────────────────────────────────────────────

describe("SQL — file I/O (adversarial)", () => {
  it("rejects SELECT … INTO OUTFILE", () => {
    const result = validateQuery(
      sql("SELECT * FROM users INTO OUTFILE '/etc/passwd'"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects LOAD DATA INFILE", () => {
    const result = validateQuery(
      sql("LOAD DATA INFILE '/etc/passwd' INTO TABLE users"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects COPY … TO file", () => {
    const result = validateQuery(
      sql("COPY users TO '/tmp/out.csv'"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });
});

// ── Non-SELECT verbs ───────────────────────────────────────────────────────────

describe("SQL — non-SELECT verbs", () => {
  it("rejects a bare CALL statement", () => {
    const result = validateQuery(sql("CALL some_procedure()"), PG_OPTS);
    expect(result.ok).toBe(false);
  });

  it("rejects GRANT statement", () => {
    const result = validateQuery(
      sql("GRANT SELECT ON users TO evil"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects REVOKE statement", () => {
    const result = validateQuery(
      sql("REVOKE SELECT ON users FROM app_user"),
      PG_OPTS,
    );
    expect(result.ok).toBe(false);
  });
});

// ── Literal parameterization ───────────────────────────────────────────────────

describe("SQL — literal parameterization", () => {
  it("parameterizes string literals in WHERE", () => {
    const result = validateQuery(
      sql("SELECT id FROM public.users WHERE name = 'alice' LIMIT 10"),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedSqlQuery;
      // Original literal value captured.
      expect(q.params).toContain("alice");
      // SQL uses placeholder, not the raw string.
      expect(q.sql).not.toContain("'alice'");
      expect(q.sql).toMatch(/\$\d+/);
    }
  });

  it("parameterizes numeric literals in WHERE", () => {
    const result = validateQuery(
      sql("SELECT * FROM public.orders WHERE amount > 100 LIMIT 10"),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedSqlQuery;
      expect(q.params).toContain(100);
    }
  });

  it("preserves multiple literals as ordered params", () => {
    const result = validateQuery(
      sql(`SELECT id FROM public.t WHERE a = 'foo' AND b = 42 LIMIT 10`),
      PG_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedSqlQuery;
      expect(q.params).toContain("foo");
      expect(q.params).toContain(42);
    }
  });

  it("does not parameterize LIMIT value", () => {
    const result = validateQuery(
      sql("SELECT id FROM public.users LIMIT 50"),
      { ...PG_OPTS, maxRowLimit: 1000 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedSqlQuery;
      // 50 is a structural LIMIT, not user data — should appear in SQL, not params.
      expect(q.sql).toContain("50");
      // params should be empty (no data literals).
      expect(q.params).toHaveLength(0);
    }
  });
});

// ── REST — happy path ──────────────────────────────────────────────────────────

describe("REST — happy path", () => {
  it("allows a valid endpoint with all fields", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/sales" }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedRestQuery;
      expect(q.endpoint).toBe("/api/v1/sales");
      expect(q.fields).toEqual(["id", "amount", "region"]);
      expect(q.queryParams).toEqual({});
    }
  });

  it("allows a valid endpoint with field subset", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/sales", fields: ["id", "amount"] }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedRestQuery;
      expect(q.fields).toEqual(["id", "amount"]);
    }
  });

  it("passes through query params", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/sales", params: { region: "EMEA" } }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.query as ValidatedRestQuery;
      expect(q.queryParams).toEqual({ region: "EMEA" });
    }
  });
});

// ── REST — adversarial ─────────────────────────────────────────────────────────

describe("REST — adversarial", () => {
  it("rejects endpoint not in allow-list", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/admin/secrets" }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/allow.?list|not in/i);
    }
  });

  it("rejects fields not declared for endpoint", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/sales", fields: ["id", "password"] }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/allow.?list|not in/i);
    }
  });

  it("rejects when no endpoints declared", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/sales" }),
      { restEndpoints: [] },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-JSON REST query body", () => {
    const result = validateQuery(
      { sql: "not json at all", queryType: "rest" },
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects REST body without endpoint field", () => {
    const result = validateQuery(
      rest({ fields: ["id"] }),
      { restEndpoints: ENDPOINTS },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects endpoint from a different declared path", () => {
    const result = validateQuery(
      rest({ endpoint: "/api/v1/users", fields: ["id", "amount"] }),
      { restEndpoints: ENDPOINTS },
    );
    // 'amount' is not declared for /api/v1/users.
    expect(result.ok).toBe(false);
  });
});

// ── Dialect variants ───────────────────────────────────────────────────────────

describe("SQL — MySQL dialect", () => {
  it("allows a simple SELECT under MySQL dialect", () => {
    const result = validateQuery(
      sql("SELECT id FROM users LIMIT 10"),
      { dialect: "mysql" },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects DDL under MySQL dialect", () => {
    const result = validateQuery(sql("DROP TABLE users"), { dialect: "mysql" });
    expect(result.ok).toBe(false);
  });
});

// ── Combined: oversized + injection ───────────────────────────────────────────

describe("SQL — combined adversarial", () => {
  it("rejects a query that is both oversized and DDL", () => {
    // Length check fires first.
    const bigDdl = "DROP TABLE t -- " + "x".repeat(DEFAULT_MAX_QUERY_LENGTH);
    const result = validateQuery(sql(bigDdl), PG_OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("returns VALIDATION code on all rejections", () => {
    const cases = [
      sql("INSERT INTO t VALUES (1)"),
      sql("SELECT 1; DROP TABLE t"),
      sql("DELETE FROM t"),
      sql("UPDATE t SET x = 1"),
      sql(""),
      sql("SELECT * INTO OUTFILE '/tmp/x'"),
    ];
    for (const c of cases) {
      const r = validateQuery(c, PG_OPTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    }
  });
});
