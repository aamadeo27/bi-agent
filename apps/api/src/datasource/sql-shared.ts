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

// ── DB-specific type string → ColumnType mappers (for introspection) ──────────

export function mapPgType(pgDataType: string): string {
  const t = pgDataType.toLowerCase();
  if (/\bint\b|smallserial|bigserial|\bserial\b/.test(t)) return "integer";
  if (/float|double precision|real|numeric|decimal/.test(t)) return "number";
  if (/bool/.test(t)) return "boolean";
  if (/timestamp/.test(t)) return "datetime";
  if (t === "date") return "date";
  return "string";
}

export function mapMysqlType(mysqlType: string): string {
  const t = mysqlType.toLowerCase();
  // tinyint(1) is MySQL's boolean representation
  if (/^tinyint\(1\)/.test(t)) return "boolean";
  if (/^(tinyint|smallint|mediumint|bigint|int)/.test(t)) return "integer";
  if (/^(float|double|decimal|numeric|real)/.test(t)) return "number";
  if (/^(datetime|timestamp)/.test(t)) return "datetime";
  if (t === "date") return "date";
  return "string";
}

export function mapBigQueryType(bqType: string): string {
  const t = bqType.toUpperCase();
  if (
    ["INT64", "INTEGER", "INT", "SMALLINT", "TINYINT", "BYTEINT"].includes(t)
  )
    return "integer";
  if (
    ["FLOAT64", "FLOAT", "NUMERIC", "BIGNUMERIC", "DECIMAL", "BIGDECIMAL"].includes(
      t,
    )
  )
    return "number";
  if (["BOOL", "BOOLEAN"].includes(t)) return "boolean";
  if (["DATETIME", "TIMESTAMP"].includes(t)) return "datetime";
  if (t === "DATE") return "date";
  return "string";
}
