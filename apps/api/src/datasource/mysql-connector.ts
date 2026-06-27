/**
 * MySQL adapter — implements Connector<SqlQuery> using the `mysql2` driver.
 *
 * Security model:
 *   - Each query runs inside a READ ONLY transaction with a per-session
 *     max_execution_time guard (MySQL 8+).
 *   - Rows are capped at maxRows using a wrapping subquery (maxRows+1 fetch).
 *   - Connection pooling is internal; no connect/disconnect on the interface.
 */
import { createPool } from "mysql2/promise";
import type { Pool, PoolConnection, RowDataPacket, FieldPacket } from "mysql2/promise";
import type { SchemaTree } from "@bi/contracts";
import type { Connector, QueryResult, QueryColumn } from "./connector.js";
import { ConnectorDataSourceError } from "./rest-connector.js";
import {
  type SqlQuery,
  inferSqlType,
  inferRole,
  normalizeValue,
  mapMysqlType,
} from "./sql-shared.js";

export type { SqlQuery };

// ── Credential + options ───────────────────────────────────────────────────────

export interface MysqlCredential {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  /** Enable SSL (rejectUnauthorized: false). */
  ssl?: boolean;
}

export interface MysqlConnectorOptions {
  /** Statement timeout in milliseconds via max_execution_time (default: 30 s). */
  statementTimeoutMs?: number;
  /** Maximum rows returned per query (default: 5 000). */
  maxRows?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ROWS = 5_000;

// ── MysqlConnector ─────────────────────────────────────────────────────────────

export class MysqlConnector implements Connector<SqlQuery> {
  private readonly pool: Pool;
  private readonly statementTimeoutMs: number;
  private readonly maxRows: number;

  constructor(cred: MysqlCredential, opts: MysqlConnectorOptions = {}) {
    this.pool = createPool({
      host: cred.host,
      port: cred.port ?? 3306,
      database: cred.database,
      user: cred.user,
      password: cred.password,
      connectionLimit: 5,
      waitForConnections: true,
      ...(cred.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    this.statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  }

  // ── testConnection ──────────────────────────────────────────────────────────

  async testConnection(): Promise<void> {
    let conn: PoolConnection;
    try {
      conn = await this.pool.getConnection();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      await conn.query("SELECT 1");
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection test failed: ${(err as Error).message}`,
      );
    } finally {
      conn.release();
    }
  }

  // ── introspect ──────────────────────────────────────────────────────────────

  async introspect(dataSourceId: string): Promise<SchemaTree> {
    let conn: PoolConnection;
    try {
      conn = await this.pool.getConnection();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_schema, table_name, column_name, column_type
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
         ORDER BY table_name, ordinal_position`,
      );

      if (rows.length === 0) {
        return { dataSourceId, schemas: [] };
      }

      const schemaName = rows[0]!["table_schema"] as string;
      const tableMap = new Map<string, { name: string; type: string }[]>();
      for (const row of rows) {
        const tname = row["table_name"] as string;
        if (!tableMap.has(tname)) tableMap.set(tname, []);
        tableMap.get(tname)!.push({
          name: row["column_name"] as string,
          type: mapMysqlType(row["column_type"] as string),
        });
      }

      return {
        dataSourceId,
        schemas: [
          {
            name: schemaName,
            tables: [...tableMap.entries()].map(([name, columns]) => ({
              name,
              columns,
            })),
          },
        ],
      };
    } catch (err) {
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Introspection failed: ${(err as Error).message}`,
      );
    } finally {
      conn.release();
    }
  }

  // ── query ───────────────────────────────────────────────────────────────────

  async query(q: SqlQuery): Promise<QueryResult> {
    let conn: PoolConnection;
    try {
      conn = await this.pool.getConnection();
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
    try {
      const timeoutMs = q.timeoutMs ?? this.statementTimeoutMs;
      const cap = this.maxRows;

      // MySQL 8+ per-session statement timeout (milliseconds).
      await conn.query(`SET SESSION max_execution_time = ${timeoutMs}`);
      await conn.query("START TRANSACTION READ ONLY");

      // Wrap in subquery to apply row cap without modifying the original SQL.
      const wrapped = `SELECT * FROM (${q.sql}) AS _q LIMIT ${cap + 1}`;
      const [rows, fields] = await conn.query<RowDataPacket[]>({
        sql: wrapped,
        values: q.params ?? [],
      });
      await conn.query("COMMIT");

      const rowCount = rows.length;
      const truncated = rowCount > cap;
      const cappedRows = truncated ? rows.slice(0, cap) : rows;

      const sample = cappedRows[0] ?? {};
      const columns: QueryColumn[] = (fields as FieldPacket[]).map((f) => {
        const type = inferSqlType(sample[f.name ?? ""]);
        return { name: f.name ?? "", type, role: inferRole(type) };
      });

      const normalizedRows = cappedRows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, normalizeValue(v)]),
        ),
      );

      return { columns, rows: normalizedRows, rowCount, truncated };
    } catch (err) {
      await conn.query("ROLLBACK").catch(() => {});
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Query failed: ${(err as Error).message}`,
      );
    } finally {
      conn.release();
    }
  }

  /** Drain the pool — call in tests / shutdown. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
