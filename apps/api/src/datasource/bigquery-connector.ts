/**
 * BigQuery adapter — implements Connector<SqlQuery> using @google-cloud/bigquery.
 *
 * Security model:
 *   - Queries run with jobTimeoutMs + maximumBytesBilled caps.
 *   - Rows are capped at maxRows using a wrapping subquery (maxRows+1 fetch).
 *   - The BigQuery client is stateless; no connection pool needed.
 */
import { BigQuery } from "@google-cloud/bigquery";
import type { SchemaTree } from "@bi/contracts";
import type { Connector, QueryResult, QueryColumn } from "./connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";
import {
  type SqlQuery,
  inferSqlType,
  inferRole,
  normalizeValue,
  mapBigQueryType,
} from "./sql-shared.js";

export type { SqlQuery };

// ── Credential + options ───────────────────────────────────────────────────────

export interface BigQueryCredential {
  projectId: string;
  /** Service-account key fields (from JSON key file). Never logged. */
  credentials: {
    client_email: string;
    private_key: string;
  };
  /** BigQuery location, e.g. "US" or "EU" (default: "US"). */
  location?: string;
}

export interface BigQueryConnectorOptions {
  /** Per-query timeout in milliseconds (default: 60 s). */
  queryTimeoutMs?: number;
  /** Maximum rows returned per query (default: 5 000). */
  maxRows?: number;
  /**
   * Maximum bytes billed per query (default: 10 GB).
   * Prevents runaway scans on large tables.
   */
  maxBytesBilled?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_BYTES_BILLED = 10 * 1024 * 1024 * 1024; // 10 GB

// ── BigQueryConnector ──────────────────────────────────────────────────────────

export class BigQueryConnector implements Connector<SqlQuery> {
  private readonly client: BigQuery;
  private readonly location: string;
  private readonly queryTimeoutMs: number;
  private readonly maxRows: number;
  private readonly maxBytesBilled: number;

  constructor(cred: BigQueryCredential, opts: BigQueryConnectorOptions = {}) {
    this.client = new BigQuery({
      projectId: cred.projectId,
      credentials: cred.credentials,
    });
    this.location = cred.location ?? "US";
    this.queryTimeoutMs = opts.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    this.maxBytesBilled = opts.maxBytesBilled ?? DEFAULT_MAX_BYTES_BILLED;
  }

  // ── testConnection ──────────────────────────────────────────────────────────

  async testConnection(): Promise<void> {
    try {
      await this.client.query({
        query: "SELECT 1 AS ok",
        location: this.location,
        jobTimeoutMs: 10_000,
        maximumBytesBilled: "1048576", // 1 MB
      });
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection test failed: ${(err as Error).message}`,
      );
    }
  }

  // ── introspect ──────────────────────────────────────────────────────────────

  async introspect(dataSourceId: string): Promise<SchemaTree> {
    try {
      const [datasets] = await this.client.getDatasets();
      const schemas = await Promise.all(
        datasets.map(async (dataset) => {
          const [tables] = await dataset.getTables();
          const tableList = await Promise.all(
            tables.map(async (table) => {
              const [metadata] = await table.getMetadata();
              const fields = (
                (metadata as Record<string, unknown>)["schema"] as
                  | { fields?: Array<{ name: string; type: string }> }
                  | undefined
              )?.fields ?? [];
              return {
                name: table.id ?? "",
                columns: fields.map((f) => ({
                  name: f.name,
                  type: mapBigQueryType(f.type),
                })),
              };
            }),
          );
          return {
            name: dataset.id ?? "",
            tables: tableList,
          };
        }),
      );
      return { dataSourceId, schemas };
    } catch (err) {
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Introspection failed: ${(err as Error).message}`,
      );
    }
  }

  // ── query ───────────────────────────────────────────────────────────────────

  async query(q: SqlQuery): Promise<QueryResult> {
    const cap = this.maxRows;
    // Wrap in subquery to apply row cap without modifying the original SQL.
    const wrapped = `SELECT * FROM (${q.sql}) AS _q LIMIT ${cap + 1}`;

    let rawRows: Record<string, unknown>[];
    try {
      const [result] = await this.client.query({
        query: wrapped,
        params: (q.params ?? []) as unknown[],
        location: this.location,
        jobTimeoutMs: q.timeoutMs ?? this.queryTimeoutMs,
        maximumBytesBilled: String(this.maxBytesBilled),
      });
      rawRows = result as Record<string, unknown>[];
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Query failed: ${(err as Error).message}`,
      );
    }

    const rowCount = rawRows.length;
    const truncated = rowCount > cap;
    const cappedRows = truncated ? rawRows.slice(0, cap) : rawRows;

    // Infer column types from first row values (BQ returns typed JS objects).
    const sample = cappedRows[0] ?? {};
    const colNames = Object.keys(sample);
    const columns: QueryColumn[] = colNames.map((name) => {
      const type = inferSqlType(sample[name]);
      return { name, type, role: inferRole(type) };
    });

    const rows = cappedRows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, normalizeValue(v)]),
      ),
    );

    return { columns, rows, rowCount, truncated };
  }
}
