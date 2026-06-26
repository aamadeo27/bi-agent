/**
 * Shared Connector interface — implemented by SQL adapters (T4.2) and the
 * REST adapter (T4.3). The query proxy (T4.4) calls through this interface.
 */
import type { SchemaTree, ColumnType } from "@bi/contracts";

export type { SchemaTree, ColumnType };

// ── Query result (pre-envelope) ────────────────────────────────────────────────
// The ask pipeline (T5.x) wraps this in a full ResultEnvelope (adds messageId,
// chartType, queryType).

export interface QueryColumn {
  name: string;
  type: ColumnType;
  role: "dimension" | "measure" | "time";
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;
  truncated: boolean;
}

// ── REST query input ───────────────────────────────────────────────────────────

export interface RestQuery {
  kind: "rest";
  /** Path must match a declared endpoint in the connector's allow-list. */
  endpoint: string;
  /** Optional query-string params forwarded verbatim. */
  params?: Record<string, string>;
  /**
   * Optional field subset — must be within the endpoint's declared fields.
   * Defaults to all declared fields when omitted.
   */
  fields?: string[];
}

// ── Connector interface ────────────────────────────────────────────────────────

export interface Connector<Q = RestQuery> {
  /** Smoke-test the connection; throws ConnectorDataSourceError on failure. */
  testConnection(): Promise<void>;
  /** Return the schema tree used by the grant editor (GET /api/admin/schema/:id). */
  introspect(dataSourceId: string): Promise<SchemaTree>;
  /** Execute a validated, allow-listed query and return raw result data. */
  query(q: Q): Promise<QueryResult>;
}
