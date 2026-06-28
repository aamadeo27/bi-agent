/**
 * T5.4 — Chart-type selection (pure).
 *
 * Infers column roles (dimension / measure / time) from ColumnType,
 * then maps the result shape to a chart type per UI/UX §9.
 *
 * Priority order:
 *   1. 0 rows          → table
 *   2. >2000 rows      → table  (GAP-8)
 *   3. 1 time + 1+ measures → line  (tie-break: prefer line when time present)
 *   4. 1 dim + 1 measure:
 *        distinct 3–8  → pie
 *        otherwise     → bar
 *   5. everything else → table
 */

import type { ColumnType } from "@bi/contracts";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface InputColumn {
  name: string;
  type: ColumnType;
}

export type ColumnRole = "dimension" | "measure" | "time";

export interface ScoredColumn {
  name: string;
  type: ColumnType;
  role: ColumnRole;
}

export type ChartType = "bar" | "line" | "pie" | "table";

export interface ChartSelectionResult {
  chartType: ChartType;
  columns: ScoredColumn[];
  notes?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const ROW_CAP = 2000;
const PIE_MIN_DISTINCT = 3;
const PIE_MAX_DISTINCT = 8;

// ── Role inference ─────────────────────────────────────────────────────────────

/**
 * Assign a role to each column based solely on its ColumnType.
 *
 * - date / datetime → time
 * - number / integer → measure
 * - string / boolean → dimension
 */
export function inferRole(type: ColumnType): ColumnRole {
  switch (type) {
    case "date":
    case "datetime":
      return "time";
    case "number":
    case "integer":
      return "measure";
    case "string":
    case "boolean":
      return "dimension";
  }
}

// ── Distinct-value count ───────────────────────────────────────────────────────

/**
 * Count distinct non-null values for `columnName` across `rows`.
 * Used to determine pie-chart eligibility.
 */
export function countDistinct(
  columnName: string,
  rows: Array<Record<string, string | number | null>>,
): number {
  const seen = new Set<string | number>();
  for (const row of rows) {
    const v = row[columnName];
    if (v !== null && v !== undefined) seen.add(v);
  }
  return seen.size;
}

// ── Main selection function ────────────────────────────────────────────────────

/**
 * Select a chart type and annotate columns with roles.
 *
 * @param columns  Raw column descriptors (name + ColumnType).
 * @param rows     Actual result rows (possibly capped to ROW_CAP).
 * @param rowCount Total rows produced by the query (pre-cap).
 */
export function selectChartType(
  columns: InputColumn[],
  rows: Array<Record<string, string | number | null>>,
  rowCount: number,
): ChartSelectionResult {
  // Annotate columns with roles upfront — needed for all paths.
  const scored: ScoredColumn[] = columns.map((c) => ({
    name: c.name,
    type: c.type,
    role: inferRole(c.type),
  }));

  // ── Rule 1: 0 rows → table ─────────────────────────────────────────────────
  if (rowCount === 0) {
    return { chartType: "table", columns: scored, notes: "no rows returned" };
  }

  // ── Rule 2: >2000 rows → table ─────────────────────────────────────────────
  if (rowCount > ROW_CAP) {
    return {
      chartType: "table",
      columns: scored,
      notes: `downgraded to table: >${ROW_CAP} rows`,
    };
  }

  const times = scored.filter((c) => c.role === "time");
  const measures = scored.filter((c) => c.role === "measure");
  const dims = scored.filter((c) => c.role === "dimension");

  // ── Rule 3: 1 time dim + 1+ measures → line ────────────────────────────────
  if (times.length === 1 && measures.length >= 1 && dims.length === 0) {
    return { chartType: "line", columns: scored };
  }

  // ── Rule 4: 1 categorical dim + 1 measure ──────────────────────────────────
  if (dims.length === 1 && measures.length === 1 && times.length === 0) {
    const distinct = countDistinct(dims[0].name, rows);
    if (distinct >= PIE_MIN_DISTINCT && distinct <= PIE_MAX_DISTINCT) {
      return { chartType: "pie", columns: scored };
    }
    return { chartType: "bar", columns: scored };
  }

  // ── Rule 5: fallback ───────────────────────────────────────────────────────
  return { chartType: "table", columns: scored };
}
