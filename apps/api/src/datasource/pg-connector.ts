/**
 * PostgreSQL adapter — implements Connector<SqlQuery> using the `pg` driver.
 *
 * Security model:
 *   - Each query runs inside a READ ONLY transaction with a per-statement timeout.
 *   - Rows are capped at maxRows; the wrapping subquery fetches maxRows+1 so
 *     truncation is detectable without a separate COUNT(*).
 *   - Connection pooling is internal; no connect/disconnect on the interface.
 */
import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { SchemaTree } from "@bi/contracts";
import type { Connector, QueryResult, QueryColumn } from "./connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";
import {
  type SqlQuery,
  inferRole,
  normalizeValue,
  mapPgType,
  mapPgOid,
} from "./sql-shared.js";

export type { SqlQuery };

// ── Credential + options ───────────────────────────────────────────────────────

export interface PgCredential {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  /** Enable SSL (rejectUnauthorized: false). */
  ssl?: boolean;
}

export interface PgConnectorOptions {
  /** Statement timeout in milliseconds (default: 30 s). */
  statementTimeoutMs?: number;
  /** Maximum rows returned per query (default: 5 000). */
  maxRows?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ROWS = 5_000;

// ── PgConnector ────────────────────────────────────────────────────────────────

export class PgConnector implements Connector<SqlQuery> {
  private readonly pool: Pool;
  private readonly statementTimeoutMs: number;
  private readonly maxRows: number;

  constructor(cred: PgCredential, opts: PgConnectorOptions = {}) {
    this.pool = new Pool({
      host: cred.host,
      port: cred.port ?? 5432,
      database: cred.database,
      user: cred.user,
      password: cred.password,
      ssl: cred.ssl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    this.statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  }

  // ── testConnection ──────────────────────────────────────────────────────────

  async testConnection(): Promise<void> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      await client.query("SELECT 1");
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection test failed: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }

  // ── introspect ──────────────────────────────────────────────────────────────

  async introspect(dataSourceId: string): Promise<SchemaTree> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      const res = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         ORDER BY table_schema, table_name, ordinal_position`,
      );

      const schemaMap = new Map<
        string,
        Map<string, { name: string; type: string }[]>
      >();
      for (const row of res.rows) {
        if (!schemaMap.has(row.table_schema)) {
          schemaMap.set(row.table_schema, new Map());
        }
        const tableMap = schemaMap.get(row.table_schema)!;
        if (!tableMap.has(row.table_name)) {
          tableMap.set(row.table_name, []);
        }
        tableMap
          .get(row.table_name)!
          .push({ name: row.column_name, type: mapPgType(row.data_type) });
      }

      return {
        dataSourceId,
        schemas: [...schemaMap.entries()].map(([name, tables]) => ({
          name,
          tables: [...tables.entries()].map(([tname, columns]) => ({
            name: tname,
            columns,
          })),
        })),
      };
    } catch (err) {
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Introspection failed: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }

  // ── query ───────────────────────────────────────────────────────────────────

  async query(q: SqlQuery): Promise<QueryResult> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      const timeoutMs = q.timeoutMs ?? this.statementTimeoutMs;
      const cap = this.maxRows;

      await client.query("BEGIN");
      await client.query("SET LOCAL TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);

      // Wrap in subquery to apply row cap without modifying the original SQL.
      const wrapped = `SELECT * FROM (${q.sql}) AS _q LIMIT ${cap + 1}`;
      const res = await client.query({
        text: wrapped,
        values: (q.params ?? []) as unknown[],
      });
      await client.query("COMMIT");

      const fetched = res.rows.length;
      const truncated = fetched > cap;
      const cappedRows = truncated ? res.rows.slice(0, cap) : res.rows;

      // Use the pg field OID for reliable type mapping — pg returns NUMERIC
      // columns as strings, so value-based inference would misclassify them.
      const columns: QueryColumn[] = res.fields.map((f) => {
        const type = mapPgOid(f.dataTypeID);
        return { name: f.name, type, role: inferRole(type) };
      });

      const rows = cappedRows.map((row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, normalizeValue(v)]),
        ),
      );

      // rowCount = rows we're returning; truncated=true signals more rows exist.
      return { columns, rows, rowCount: cappedRows.length, truncated };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Query failed: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }

  /** Drain the pool — call in tests / shutdown. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
