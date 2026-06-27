/**
 * Shared types and helpers for SQL adapters (PG, MySQL, BigQuery).
 */
import type { ColumnType } from "@bi/contracts";
import type { QueryColumn } from "./connector.js";

// ── SqlQuery — the query-input type for all SQL adapters ───────────────────────

export interface SqlQuery {
  kind: "sql";
  /** Pre-validated SELECT statement (allow-listed upstream). */
  sql: string;
  /** Positional or named parameters — passed to the driver verbatim. */
  params?: unknown[];
  /** Per-query statement timeout override (ms). Falls back to adapter default. */
  timeoutMs?: number;
}

// ── Type inference from runtime values ────────────────────────────────────────

export function inferSqlType(value: unknown): ColumnType {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) {
    const hasTime =
      value.getUTCHours() !== 0 ||
      value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0 ||
      value.getUTCMilliseconds() !== 0;
    return hasTime ? "datetime" : "date";
  }
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  }
  return "string";
}

export function inferRole(type: ColumnType): QueryColumn["role"] {
  if (type === "number" || type === "integer") return "measure";
  if (type === "date" || type === "datetime") return "time";
  return "dimension";
}

export function normalizeValue(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return JSON.stringify(val);
}

// ── First non-null value helper (for column type inference from result rows) ───

/**
 * Returns the first non-null/undefined value for `key` across `rows`.
 * Falls back to `null` when all rows have null/undefined for that key.
 * Used to avoid misclassifying nullable columns as "string" when row 0 is NULL.
 */
export function firstNonNullValue(
  rows: Record<string, unknown>[],
  key: string,
): unknown {
  for (const row of rows) {
    const v = row[key];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// ── DB-specific type string → ColumnType mappers (for introspection) ──────────
//
// `information_schema.columns.data_type` returns canonical SQL type names
// (e.g. "integer", "bigint", "timestamp without time zone") — NOT driver
// shorthand ("int", "int4") or DDL aliases ("serial").

export function mapPgType(pgDataType: string): ColumnType {
  const t = pgDataType.toLowerCase();
  // Exact matches for canonical information_schema names
  if (t === "integer" || t === "bigint" || t === "smallint") return "integer";
  if (
    t === "double precision" ||
    t === "real" ||
    t === "numeric" ||
    t === "decimal" ||
    t === "money"
  )
    return "number";
  if (t === "boolean") return "boolean";
  if (t === "timestamp without time zone" || t === "timestamp with time zone")
    return "datetime";
  if (t === "date") return "date";
  return "string";
}

export function mapMysqlType(mysqlType: string): ColumnType {
  const t = mysqlType.toLowerCase();
  // tinyint(1) is MySQL's boolean representation
  if (/^tinyint\(1\)/.test(t)) return "boolean";
  if (/^(tinyint|smallint|mediumint|bigint|int)/.test(t)) return "integer";
  if (/^(float|double|decimal|numeric|real)/.test(t)) return "number";
  if (/^(datetime|timestamp)/.test(t)) return "datetime";
  if (t === "date") return "date";
  return "string";
}

export function mapBigQueryType(bqType: string): ColumnType {
  const t = bqType.toUpperCase();
  if (
    ["INT64", "INTEGER", "INT", "SMALLINT", "TINYINT", "BYTEINT"].includes(t)
  )
    return "integer";
  if (
    [
      "FLOAT64",
      "FLOAT",
      "NUMERIC",
      "BIGNUMERIC",
      "DECIMAL",
      "BIGDECIMAL",
    ].includes(t)
  )
    return "number";
  if (["BOOL", "BOOLEAN"].includes(t)) return "boolean";
  if (["DATETIME", "TIMESTAMP"].includes(t)) return "datetime";
  if (t === "DATE") return "date";
  return "string";
}
