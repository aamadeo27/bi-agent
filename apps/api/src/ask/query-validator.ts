/**
 * T5.3 — Query validator & injection guard.
 *
 * Runs after the permission gate (T5.2), before execution.
 * Defends NFR-SEC-3.
 *
 * SQL rules:
 *   - SELECT only (AST type check)
 *   - No multi-statement (semicolon chains, parser array result)
 *   - No comment-hidden statements
 *   - No DDL / DML
 *   - No INTO OUTFILE / COPY / LOAD DATA / LOAD_FILE
 *   - No non-allow-listed set-returning functions in FROM
 *   - Enforces max query length + LIMIT cap
 *   - Parameterizes string/number literals (WHERE, HAVING, …)
 *
 * REST rules:
 *   - Endpoint must be in connector's declared allow-list
 *   - Fields must be within declared fields for that endpoint
 *   - Params must be string key/value pairs
 */

import { Parser, type AST } from "node-sql-parser";
import { logger } from "../observability/logger.js";
import type { GeneratedQuery, Dialect } from "./permission-gate.js";
import type { EndpointDecl } from "../datasource/rest-connector.js";

// ── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_QUERY_LENGTH = 8_000;
export const DEFAULT_MAX_ROW_LIMIT = 10_000;

/**
 * Explicit allow-list of set-returning functions (SRFs) permitted in FROM clauses.
 * Per KB query-validation-injection-guard: "set-returning functions not allow-listed"
 * are rejected — semantics are allow-list (unknown = blocked), not deny-list.
 *
 * Add only SRFs that are safe for read-only analytics and carry no file/network access.
 */
const ALLOWED_FROM_FUNCTIONS = new Set([
  // Array expansion
  "unnest",
  // Series / subscript generation (date ranges, number sequences)
  "generate_series",
  "generate_subscripts",
  // JSON / JSONB array expansion
  "json_array_elements",
  "jsonb_array_elements",
  "json_array_elements_text",
  "jsonb_array_elements_text",
  // JSON / JSONB object expansion
  "json_each",
  "jsonb_each",
  "json_each_text",
  "jsonb_each_text",
  // String splitting
  "regexp_split_to_table",
  "string_to_table",
]);

/**
 * Statement-level AST types that are never permitted.
 * SELECT (and CTE-wrapped SELECTs) are the only allowed types.
 */
const BLOCKED_STATEMENT_TYPES = new Set([
  "insert",
  "update",
  "delete",
  "create",
  "drop",
  "alter",
  "truncate",
  "replace",
  "rename",
  "grant",
  "revoke",
  "call",
  "execute",
  "exec",
  "load",
  "copy",
  "merge",
  "upsert",
]);

// Belt-and-suspenders regex checks on comment-stripped SQL.
const DDL_DML_RE =
  /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+\w|CREATE\s+\w|ALTER\s+\w|TRUNCATE\s+\w|REPLACE\s+INTO|RENAME\s+\w|GRANT\s+\w|REVOKE\s+\w|CALL\s+\w|EXECUTE\s+\w|EXEC\s+\w|MERGE\s+\w|UPSERT\s+\w)\b/i;
const FILE_IO_RE =
  /\b(INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD\s+DATA|LOAD_FILE\s*\(|COPY\s+\w+\s+(?:TO|FROM))\b/i;

// ── Output types ───────────────────────────────────────────────────────────────

export interface ValidatedSqlQuery {
  queryType: "sql";
  /** The (possibly LIMIT-capped and parameterized) SQL text. */
  sql: string;
  /** Extracted literal values, positionally matching $1, $2, … placeholders. */
  params: unknown[];
}

export interface ValidatedRestQuery {
  queryType: "rest";
  endpoint: string;
  fields: string[];
  queryParams: Record<string, string>;
}

export type ValidatedQuery = ValidatedSqlQuery | ValidatedRestQuery;

export interface ValidationError {
  code: "VALIDATION";
  message: string;
}

export type ValidationResult =
  | { ok: true; query: ValidatedQuery }
  | { ok: false; error: ValidationError };

// ── Options ────────────────────────────────────────────────────────────────────

export interface ValidatorOptions {
  dialect?: Dialect;
  maxQueryLength?: number;
  maxRowLimit?: number;
  /** Connector's declared REST endpoints (required when validating REST queries). */
  restEndpoints?: EndpointDecl[];
  /**
   * Pre-parsed AST from the permission gate (same SQL, same dialect).
   * When provided, the validator skips its own `astify` call to avoid a
   * redundant parse pass on the hot path.
   */
  precomputedAst?: unknown;
}

// ── Internal AST type alias ────────────────────────────────────────────────────

type ASTNode = Record<string, unknown>;

// Module-level constant — hoisted out of parameterizeLiterals to avoid
// per-call allocation during recursion.
const PRESERVE_KEYS = new Set(["limit", "offset", "separator"]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function fail(message: string): ValidationResult {
  return { ok: false, error: { code: "VALIDATION", message } };
}

/**
 * Strips SQL line comments (--) and block comments (/* … * /).
 * Used for belt-and-suspenders pattern checks after AST validation.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\r\n]*/g, " "); // line comments
}

/**
 * Returns true when the SQL contains multiple `;`-delimited statements, including
 * cases where the extra statements are hidden behind comments.
 *
 * Canonical attacks caught:
 *   SELECT 1 -- ;\nDROP TABLE users   (line-comment hiding)
 *   SELECT 1 /* x * /; DELETE FROM t  (block-comment hiding)
 *   SELECT 1; DROP TABLE t            (plain chaining)
 */
function hasMultipleStatements(raw: string): boolean {
  const stripped = stripSqlComments(raw);
  const parts = stripped.split(";").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1;
}

/**
 * Extracts a function name from a node-sql-parser function `name` field.
 * In v5 the name may be a plain string OR an object with a `name` array:
 *   { name: [{ type: 'origin', value: 'pg_read_file' }] }
 */
function extractFunctionName(nameField: unknown): string | null {
  if (typeof nameField === "string") return nameField.toLowerCase();
  if (nameField && typeof nameField === "object") {
    const n = nameField as ASTNode;
    if (Array.isArray(n["name"])) {
      const parts = (n["name"] as ASTNode[])
        .map((p) => (typeof p["value"] === "string" ? (p["value"] as string) : ""))
        .filter(Boolean);
      if (parts.length > 0) return parts.join("").toLowerCase();
    }
  }
  return null;
}

/**
 * Recursively collects names of table-valued / set-returning functions
 * appearing in FROM clauses (AST-based detection).
 *
 * Handles both string and object name formats across node-sql-parser versions.
 */
function collectFromFunctions(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectFromFunctions(item, out);
    return;
  }
  const n = node as ASTNode;

  if (Array.isArray(n["from"])) {
    for (const fi of n["from"] as ASTNode[]) {
      const expr = fi["expr"];
      if (expr && typeof expr === "object") {
        const e = expr as ASTNode;
        if (e["type"] === "function") {
          const name = extractFunctionName(e["name"]);
          if (name) out.add(name);
        }
      }
      collectFromFunctions(fi["expr"], out);
    }
  }

  for (const key of Object.keys(n)) {
    if (key !== "from") collectFromFunctions(n[key], out);
  }
}

// Regex to detect function calls in FROM / JOIN position on the stripped SQL.
// Catches SRFs that the parser may treat as table references rather than functions,
// and novel SRFs that would cause parse errors before the AST check runs.
// Handles optional LATERAL keyword.
const FROM_FUNCTION_RE = /\b(?:FROM|JOIN)\s+(?:LATERAL\s+)?(\w+)\s*\(/gi;

/**
 * Text-level scan for function calls in FROM/JOIN position.
 * Belt-and-suspenders: runs before AST parsing so it catches SRFs that
 * node-sql-parser parses as table names or rejects with a syntax error.
 */
function collectFromFunctionsViaText(strippedSql: string, out: Set<string>): void {
  const re = new RegExp(FROM_FUNCTION_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(strippedSql)) !== null) {
    out.add(match[1].toLowerCase());
  }
}

/**
 * Recursively scans the AST for any blocked statement-level type.
 * Guards against DML embedded in subqueries.
 */
function findBlockedStatementType(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findBlockedStatementType(item);
      if (found) return found;
    }
    return null;
  }
  const n = node as ASTNode;
  const type = n["type"];
  if (
    typeof type === "string" &&
    type !== "select" &&
    type !== "(select)" &&
    BLOCKED_STATEMENT_TYPES.has(type.toLowerCase())
  ) {
    return type;
  }
  for (const val of Object.values(n)) {
    const found = findBlockedStatementType(val);
    if (found) return found;
  }
  return null;
}

/**
 * Enforces LIMIT ≤ maxRowLimit.
 * Adds a LIMIT clause when absent, clamps when present but too large.
 */
function enforceLimit(ast: ASTNode, maxRowLimit: number): ASTNode {
  if (ast["type"] !== "select") return ast;

  const existingLimit = ast["limit"];
  let currentValue: number | null = null;

  if (existingLimit && typeof existingLimit === "object") {
    const lv = (existingLimit as ASTNode)["value"];
    if (Array.isArray(lv) && lv.length > 0) {
      const first = lv[0] as ASTNode;
      if (first["type"] === "number" && typeof first["value"] === "number") {
        currentValue = first["value"] as number;
      }
    }
  }

  if (currentValue === null || currentValue > maxRowLimit) {
    return {
      ...ast,
      limit: {
        separator: "",
        value: [{ type: "number", value: maxRowLimit }],
      },
    };
  }
  return ast;
}

/**
 * Recursively replaces string and number literal nodes with $N positional
 * parameter placeholders (PostgreSQL convention), collecting original values.
 *
 * LIMIT and OFFSET nodes are skipped — they are structural constraints,
 * not user-supplied data.
 *
 * Booleans and NULLs are left in place — no injection risk.
 */
function parameterizeLiterals(node: unknown, params: unknown[]): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    return node.map((item) => parameterizeLiterals(item, params));
  }
  if (typeof node !== "object") return node;

  const n = node as ASTNode;
  const type = n["type"];

  // String literals → $N
  if (
    (type === "single_quote_string" || type === "double_quote_string") &&
    typeof n["value"] === "string"
  ) {
    params.push(n["value"]);
    return { type: "origin", value: `$${params.length}` };
  }

  // Numeric literals → $N
  if (type === "number" && typeof n["value"] === "number") {
    params.push(n["value"]);
    return { type: "origin", value: `$${params.length}` };
  }

  const result: ASTNode = {};
  for (const [key, val] of Object.entries(n)) {
    result[key] = PRESERVE_KEYS.has(key) ? val : parameterizeLiterals(val, params);
  }
  return result;
}

function dialectToDb(dialect: Dialect): string {
  switch (dialect) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "bigquery":
      return "BigQuery";
    default: {
      // Exhaustive guard: if Dialect grows, return the value as-is so the
      // parser receives something rather than undefined.
      const _exhaustive: never = dialect;
      return _exhaustive;
    }
  }
}

// ── REST query parsing ─────────────────────────────────────────────────────────

interface ParsedRestCall {
  endpoint: string;
  fields?: string[];
  params?: Record<string, string>;
}

/**
 * Parses the JSON-encoded REST call that the LLM embeds in GeneratedQuery.sql
 * when queryType === "rest".
 *
 * Expected shape:
 *   { endpoint: "/api/v1/sales", fields?: [...], params?: { key: "val" } }
 */
function parseRestCall(raw: string): ParsedRestCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p["endpoint"] !== "string") return null;

  const fields =
    Array.isArray(p["fields"])
      ? (p["fields"] as unknown[]).filter((f): f is string => typeof f === "string")
      : undefined;

  const paramsRaw = p["params"];
  const params =
    paramsRaw && typeof paramsRaw === "object" && !Array.isArray(paramsRaw)
      ? Object.fromEntries(
          Object.entries(paramsRaw as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string",
          ) as Array<[string, string]>,
        )
      : undefined;

  // Use conditional spread so optional properties are absent (not `undefined`)
  // when unset — required by exactOptionalPropertyTypes: true.
  return {
    endpoint: p["endpoint"] as string,
    ...(fields !== undefined ? { fields } : {}),
    ...(params !== undefined ? { params } : {}),
  };
}

// ── SQL validator ──────────────────────────────────────────────────────────────

function validateSqlQuery(
  sql: string,
  opts: { dialect: Dialect; maxQueryLength: number; maxRowLimit: number; precomputedAst?: unknown },
): ValidationResult {
  const { dialect, maxQueryLength, maxRowLimit, precomputedAst } = opts;

  // 1. Length cap.
  if (sql.length > maxQueryLength) {
    return fail(
      `Query exceeds maximum length of ${maxQueryLength} characters (got ${sql.length})`,
    );
  }

  // 2. Empty check.
  const trimmed = sql.trim();
  if (!trimmed) return fail("Query is empty");

  // 3. Multi-statement detection (plain chains + comment-hidden).
  if (hasMultipleStatements(trimmed)) {
    return fail(
      "Multi-statement query detected (comment-hidden or semicolon-chained)",
    );
  }

  // 4. Belt+suspenders: check comment-stripped SQL for DDL/DML and file I/O.
  const stripped = stripSqlComments(trimmed);
  if (DDL_DML_RE.test(stripped)) {
    return fail("DDL/DML statement detected; only SELECT is permitted");
  }
  if (FILE_IO_RE.test(stripped)) {
    return fail("File I/O operation detected; not permitted");
  }

  // 4.5. Text-level FROM-function allow-list check — runs before AST parsing.
  //      Catches SRFs that node-sql-parser treats as plain table names, and novel
  //      SRFs whose syntax would cause a parse error before the AST check.
  {
    const textFns = new Set<string>();
    collectFromFunctionsViaText(stripped, textFns);
    for (const fn of textFns) {
      if (!ALLOWED_FROM_FUNCTIONS.has(fn)) {
        return fail(`Function not in FROM allow-list: ${fn}`);
      }
    }
  }

  // 5. Parse into AST (or reuse pre-parsed AST from the permission gate to skip re-parse).
  const dbOpt = dialectToDb(dialect);
  const parser = new Parser();
  let ast: unknown;
  if (precomputedAst !== undefined) {
    ast = precomputedAst;
  } else {
    try {
      ast = parser.astify(trimmed, { database: dbOpt });
    } catch (err) {
      return fail(`SQL parse error: ${(err as Error).message}`);
    }
  }

  // 6. Multi-statement check via AST (parser may return an array).
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      return fail("Multi-statement query is not permitted");
    }
    ast = ast[0];
  }

  const node = ast as ASTNode;

  // 7. Verb allow-list: top-level type must be SELECT only.
  const stmtType =
    typeof node["type"] === "string"
      ? (node["type"] as string).toLowerCase()
      : "";
  if (stmtType !== "select") {
    return fail(
      `Only SELECT statements are permitted; got: ${stmtType || "unknown"}`,
    );
  }

  // 8. Scan all AST nodes for embedded DDL/DML (blocks DML in subqueries).
  const blockedSubType = findBlockedStatementType(node);
  if (blockedSubType) {
    return fail(`Blocked statement type in query: ${blockedSubType}`);
  }

  // 9. Set-returning functions: allow-list semantics — anything not explicitly
  //    allowed in ALLOWED_FROM_FUNCTIONS is rejected (KB: "not allow-listed → reject").
  const fromFns = new Set<string>();
  collectFromFunctions(node, fromFns);
  for (const fn of fromFns) {
    if (!ALLOWED_FROM_FUNCTIONS.has(fn)) {
      return fail(`Function not in FROM allow-list: ${fn}`);
    }
  }

  // 10. Enforce LIMIT cap (modifies AST in place).
  const limitedNode = enforceLimit(node, maxRowLimit);

  // 11. Parameterize literals.
  const params: unknown[] = [];
  const parameterizedAst = parameterizeLiterals(limitedNode, params);

  // 12. Reconstruct SQL from modified AST.
  let finalSql: string;
  try {
    finalSql = parser.sqlify(parameterizedAst as unknown as AST, { database: dbOpt });
  } catch (sqlifyErr) {
    // sqlify failure is non-fatal: the AST-validated SQL is still safe to use.
    // Log so parameterization fallbacks are observable in production.
    logger.warn(
      { error: (sqlifyErr as Error).message },
      "[query-validator] sqlify failed during parameterization; returning original validated SQL",
    );
    finalSql = trimmed;
    params.length = 0;
  }

  return {
    ok: true,
    query: { queryType: "sql", sql: finalSql, params },
  };
}

// ── REST validator ─────────────────────────────────────────────────────────────

function validateRestQuery(
  raw: string,
  endpoints: EndpointDecl[],
): ValidationResult {
  const parsed = parseRestCall(raw);
  if (!parsed) {
    return fail(
      "REST query must be a JSON object with an 'endpoint' string field",
    );
  }

  const { endpoint, fields, params } = parsed;

  // Endpoint allow-list.
  const decl = endpoints.find((e) => e.path === endpoint);
  if (!decl) {
    return fail(`REST endpoint not in connector allow-list: ${endpoint}`);
  }

  // Field allow-list.
  const resolvedFields = fields ?? decl.fields;
  const disallowed = resolvedFields.filter((f) => !decl.fields.includes(f));
  if (disallowed.length > 0) {
    return fail(
      `REST fields not in connector allow-list: ${disallowed.join(", ")}`,
    );
  }

  return {
    ok: true,
    query: {
      queryType: "rest",
      endpoint,
      fields: resolvedFields,
      queryParams: params ?? {},
    },
  };
}

// ── Public entry point ─────────────────────────────────────────────────────────

/**
 * Validates a generated query before execution.
 *
 * For SQL: blocks injections, DDL/DML, multi-statement, and oversized queries;
 * enforces a row LIMIT cap; parameterizes literals.
 *
 * For REST: validates the endpoint and fields against the connector's declared
 * allow-list.
 *
 * Returns a `ValidatedQuery` on success or a `VALIDATION` error on rejection.
 */
export function validateQuery(
  query: GeneratedQuery,
  opts: ValidatorOptions = {},
): ValidationResult {
  const {
    dialect = "postgres",
    maxQueryLength = DEFAULT_MAX_QUERY_LENGTH,
    maxRowLimit = DEFAULT_MAX_ROW_LIMIT,
    restEndpoints = [],
    precomputedAst,
  } = opts;

  if (query.queryType === "rest") {
    return validateRestQuery(query.sql, restEndpoints);
  }

  return validateSqlQuery(query.sql, { dialect, maxQueryLength, maxRowLimit, precomputedAst });
}
