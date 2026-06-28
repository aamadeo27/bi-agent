/**
 * T5.2 — Permission gate (L1, pure).
 *
 * THE security boundary between LLM query generation and execution.
 * Uses node-sql-parser's built-in tableList() / columnList() APIs to extract
 * every referenced schema.table.column, then diffs against the role's grant set.
 * Fails closed on any gap or unresolvable reference.
 *
 * Never trusts the LLM's self-report — resources are derived from the SQL AST.
 */

import { Parser } from "node-sql-parser";
import type { ResourceGrantSet } from "@bi/contracts";

// ── Public types ───────────────────────────────────────────────────────────────

export type Dialect = "postgres" | "mysql" | "bigquery";

export interface GeneratedQuery {
  sql: string;
  queryType: "sql" | "rest";
}

/** Matches PermissionBlock.missing item shape. */
export interface ResourceRef {
  kind: "schema" | "table" | "column";
  /** "schema" | "schema.table" | "schema.table.column" */
  identifier: string;
  accessNeeded: "read";
}

export type GateResult =
  | { allow: true }
  | { allow: false; missing: ResourceRef[] };

// ── Dialect mapping ────────────────────────────────────────────────────────────

function dialectToDb(dialect: Dialect): string {
  switch (dialect) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "bigquery":
      return "BigQuery";
  }
}

// ── Virtual-name extraction (CTEs + subquery aliases) ──────────────────────────
//
// node-sql-parser's tableList() and columnList() include CTE names and subquery
// aliases as if they were real tables.  We collect them so we can skip them.

type ASTNode = Record<string, unknown>;

/** Recursively collects CTE names from WITH clauses. */
function collectCteNames(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCteNames(item, out);
    return;
  }
  const n = node as ASTNode;

  if (Array.isArray(n["with"])) {
    for (const cte of n["with"] as ASTNode[]) {
      const nameNode = cte["name"];
      let cteName: string | undefined;
      if (typeof nameNode === "string") {
        cteName = nameNode;
      } else if (nameNode && typeof nameNode === "object") {
        const v = (nameNode as ASTNode)["value"];
        if (typeof v === "string") cteName = v;
      }
      if (cteName) out.add(cteName);
      collectCteNames(cte["stmt"], out);
    }
  }

  for (const key of Object.keys(n)) {
    if (key !== "with") collectCteNames(n[key], out);
  }
}

/** Collects aliases of subqueries in FROM clauses (e.g. `(SELECT …) AS sq`). */
function collectSubqueryAliases(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectSubqueryAliases(item, out);
    return;
  }
  const n = node as ASTNode;

  if (Array.isArray(n["from"])) {
    for (const fi of n["from"] as ASTNode[]) {
      if (fi["expr"] && typeof fi["as"] === "string") {
        out.add(fi["as"]); // subquery alias
      }
      collectSubqueryAliases(fi["expr"], out);
    }
  }

  for (const key of Object.keys(n)) {
    if (key !== "from") collectSubqueryAliases(n[key], out);
  }
}

// ── tableList / columnList parsing ────────────────────────────────────────────
//
// node-sql-parser format:
//   tableList:  "operation::schema_or_null::table"
//   columnList: "operation::table_or_null::column"
//
// "null" is the literal string "null" when the qualifier is absent.

interface ParsedTableEntry {
  schema: string | null;
  table: string;
}

interface ParsedColumnEntry {
  table: string | null; // original table name or alias as recognised by the parser
  column: string; // "(.*)" for SELECT *
}

function parseTableEntries(
  rawList: string[],
  virtuals: Set<string>
): ParsedTableEntry[] {
  const seen = new Set<string>();
  const result: ParsedTableEntry[] = [];

  for (const entry of rawList) {
    const parts = entry.split("::");
    if (parts.length < 3) continue;
    const [op, rawSchema, rawTable] = parts;
    // Only care about SELECT reads.
    if (op !== "select" && op !== "(select)") continue;
    if (!rawTable || rawTable === "null") continue;
    // Skip virtual names (CTEs, subquery aliases).
    if (virtuals.has(rawTable)) continue;

    // BigQuery emits "project.dataset" in the schema slot for 3-part names.
    // Grants use only the dataset name (project maps to the DataSource).
    // Strip any leading project prefix by taking the last dot-separated segment.
    const rawSchemaFinal =
      rawSchema !== "null" && rawSchema.includes(".")
        ? rawSchema.split(".").pop()!
        : rawSchema;
    const schema =
      rawSchemaFinal === "null" || !rawSchemaFinal ? null : rawSchemaFinal;
    const key = `${schema}::${rawTable}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ schema, table: rawTable });
    }
  }
  return result;
}

function parseColumnEntries(rawList: string[]): ParsedColumnEntry[] {
  const seen = new Set<string>();
  const result: ParsedColumnEntry[] = [];

  for (const entry of rawList) {
    const parts = entry.split("::");
    if (parts.length < 3) continue;
    const [op, rawTable, rawColumn] = parts;
    if (op !== "select" && op !== "(select)") continue;
    if (!rawColumn) continue;

    const table = rawTable === "null" || !rawTable ? null : rawTable;
    const key = `${table ?? ""}::${rawColumn}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ table, column: rawColumn });
    }
  }
  return result;
}

// ── Grant predicates ───────────────────────────────────────────────────────────

/** True when the role has an explicit table grant — implies ALL columns readable. */
function hasTableGrant(
  schema: string,
  table: string,
  grants: ResourceGrantSet
): boolean {
  return grants.some(
    (g) => g.kind === "table" && g.schema === schema && g.table === table
  );
}

/**
 * True when the role can access the table at all — either via a table grant
 * (covers everything) or at least one column grant (selective access).
 */
function isTableAccessible(
  schema: string,
  table: string,
  grants: ResourceGrantSet
): boolean {
  return grants.some(
    (g) =>
      g.schema === schema &&
      ((g.kind === "table" && g.table === table) ||
        (g.kind === "column" && g.table === table))
  );
}

/**
 * True when the specific column is readable — either via a column grant or via
 * the parent table grant (table grant implies all columns).
 */
function isColumnAllowed(
  schema: string,
  table: string,
  column: string,
  grants: ResourceGrantSet
): boolean {
  return grants.some(
    (g) =>
      g.schema === schema &&
      ((g.kind === "table" && g.table === table) ||
        (g.kind === "column" && g.table === table && g.column === column))
  );
}

// ── Main gate ──────────────────────────────────────────────────────────────────

/**
 * Evaluates whether the role's grant set permits the generated query.
 *
 * Security properties:
 *  - Resources derived from SQL AST, never from LLM self-report.
 *  - Fails closed: unresolvable references → block.
 *  - Never subsets: any missing resource blocks the whole query.
 *  - Deterministic: same inputs → same output.
 *  - Handles CTEs, subqueries, JOINs, aliases, WHERE/HAVING expressions.
 */
export function evaluateGate(args: {
  query: GeneratedQuery;
  grants: ResourceGrantSet;
  dialect: Dialect;
}): GateResult {
  const { query, grants, dialect } = args;

  // REST queries are not handled by the SQL gate in v1 → fail closed.
  // missing:[] consistent with parse-error path; pipeline must not propagate
  // a synthesized identifier that violates the PermissionBlock contract format.
  if (query.queryType !== "sql") {
    return { allow: false, missing: [] };
  }

  // Empty / whitespace-only SQL → fail closed.
  if (!query.sql.trim()) {
    return { allow: false, missing: [] };
  }

  const opts = { database: dialectToDb(dialect) };
  const parser = new Parser();

  let ast: unknown;
  let rawTableList: string[];
  let rawColumnList: string[];

  try {
    ast = parser.astify(query.sql, opts);
    rawTableList = parser.tableList(query.sql, opts);
    rawColumnList = parser.columnList(query.sql, opts);
  } catch {
    // Parse failure → fail closed (cannot determine resource set).
    return { allow: false, missing: [] };
  }

  // Collect virtual table names so we don't gate on derived results.
  const virtuals = new Set<string>();
  collectCteNames(ast, virtuals);
  collectSubqueryAliases(ast, virtuals);

  // Real table references (schema + table name).
  const realTables = parseTableEntries(rawTableList, virtuals);

  // Build table-name → schema map for column resolution.
  // (node-sql-parser resolves aliases back to original table names in columnList)
  const tableSchemaMap = new Map<string, string | null>();
  for (const { schema, table } of realTables) {
    tableSchemaMap.set(table, schema);
  }

  // Column references (table may be null = unqualified, or alias already resolved).
  const columnEntries = parseColumnEntries(rawColumnList);

  // ── Deduplicated missing list ─────────────────────────────────────────────
  const missingKeys = new Set<string>();
  const missing: ResourceRef[] = [];

  function addMissing(ref: ResourceRef): void {
    const key = `${ref.kind}:${ref.identifier}`;
    if (!missingKeys.has(key)) {
      missingKeys.add(key);
      missing.push(ref);
    }
  }

  // ── Table-level checks ───────────────────────────────────────────────────
  // blockedTables tracks "schema.table" keys that are already in missing[] as
  // table-level entries.  Column checks skip these so missing[] stays exact —
  // a table entry already implies all its columns are inaccessible.
  const blockedTables = new Set<string>();

  for (const { schema, table } of realTables) {
    if (!schema) {
      // Unqualified table — can't verify without schema → fail closed.
      addMissing({ kind: "table", identifier: table, accessNeeded: "read" });
      blockedTables.add(`null.${table}`);
      continue;
    }
    if (!isTableAccessible(schema, table, grants)) {
      addMissing({
        kind: "table",
        identifier: `${schema}.${table}`,
        accessNeeded: "read",
      });
      blockedTables.add(`${schema}.${table}`);
    }
  }

  // ── Column-level checks ──────────────────────────────────────────────────
  for (const { table: colTable, column } of columnEntries) {
    // "null" table in column entry → unqualified (parser couldn't or didn't qualify).
    if (colTable === null) {
      if (column === "(.*)" || column === ".*" || column === "*") {
        // Unqualified wildcard — must have a table grant for every real table.
        for (const { schema, table } of realTables) {
          if (!schema) {
            addMissing({ kind: "table", identifier: table, accessNeeded: "read" });
            continue;
          }
          if (!hasTableGrant(schema, table, grants)) {
            addMissing({
              kind: "table",
              identifier: `${schema}.${table}`,
              accessNeeded: "read",
            });
          }
        }
        continue;
      }

      // Unqualified regular column.
      if (realTables.length === 1) {
        const { schema, table } = realTables[0];
        if (!schema) {
          if (!blockedTables.has(`null.${table}`)) {
            addMissing({ kind: "column", identifier: column, accessNeeded: "read" });
          }
          continue;
        }
        // Skip: table already in missing[] → its columns are implied missing.
        if (blockedTables.has(`${schema}.${table}`)) continue;
        if (!isColumnAllowed(schema, table, column, grants)) {
          addMissing({
            kind: "column",
            identifier: `${schema}.${table}.${column}`,
            accessNeeded: "read",
          });
        }
      } else {
        // Ambiguous: multiple real tables in scope → fail closed.
        addMissing({ kind: "column", identifier: column, accessNeeded: "read" });
      }
      continue;
    }

    // Column is virtual (from a CTE or subquery alias) → already validated in the body.
    if (virtuals.has(colTable)) continue;

    // Resolve column's table to a schema.
    const schema = tableSchemaMap.get(colTable);
    if (schema === undefined) {
      // Unknown table qualifier → fail closed.
      addMissing({ kind: "column", identifier: `${colTable}.${column}`, accessNeeded: "read" });
      continue;
    }
    if (!schema) {
      // Table present but schema unknown → fail closed.
      if (!blockedTables.has(`null.${colTable}`)) {
        addMissing({ kind: "column", identifier: `${colTable}.${column}`, accessNeeded: "read" });
      }
      continue;
    }

    // Skip: table already in missing[] → column entries are implied.
    if (blockedTables.has(`${schema}.${colTable}`)) continue;

    if (column === "(.*)" || column === ".*" || column === "*") {
      // Qualified wildcard → needs table grant.
      if (!hasTableGrant(schema, colTable, grants)) {
        addMissing({
          kind: "table",
          identifier: `${schema}.${colTable}`,
          accessNeeded: "read",
        });
      }
      continue;
    }

    if (!isColumnAllowed(schema, colTable, column, grants)) {
      addMissing({
        kind: "column",
        identifier: `${schema}.${colTable}.${column}`,
        accessNeeded: "read",
      });
    }
  }

  if (missing.length > 0) {
    return { allow: false, missing };
  }
  return { allow: true };
}
