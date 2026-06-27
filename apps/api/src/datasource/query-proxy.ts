/**
 * Query Proxy — the single component that executes data-source queries.
 *
 * Security contract (L2 backstop):
 *   - Only this module calls getCredential / decryptCredential (enforced by ESLint
 *     + unit test — see query-proxy.test.ts "only proxy touches credentials").
 *   - Credentials are decrypted in memory and never logged or serialized.
 *   - Execution uses raw drivers (pg / mysql2 / @google-cloud/bigquery / undici)
 *     on the restricted per-role credential — NEVER Prisma. Prisma is control-
 *     plane only; using it here would bypass the least-privilege DB role (L2).
 *   - The connector query-function is cached by (tenantId, roleId, dataSourceId)
 *     and invalidated automatically when the stored credential hash changes.
 */
import { createHash } from "node:crypto";
import { withTenant } from "../db/with-tenant.js";
import { decryptCredential } from "./vault.js";
import { PgConnector } from "./pg-connector.js";
import type { PgCredential } from "./pg-connector.js";
import { MysqlConnector } from "./mysql-connector.js";
import type { MysqlCredential } from "./mysql-connector.js";
import { BigQueryConnector } from "./bigquery-connector.js";
import type { BigQueryCredential } from "./bigquery-connector.js";
import { RestConnector, ConnectorDataSourceError } from "./rest-connector.js";
import type { RestCredential } from "./rest-connector.js";
import type { QueryResult, RestQuery } from "./connector.js";
import type { SqlQuery } from "./sql-shared.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ValidatedQuery = SqlQuery | RestQuery;

export interface ProxyArgs {
  tenantId: string;
  roleId: string;
  dataSourceId: string;
  query: ValidatedQuery;
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class ProxyCredentialNotFoundError extends Error {
  readonly code = "DATA_SOURCE" as const;
  constructor(dataSourceId: string, roleId: string) {
    super(
      `No credential found for dataSource=${dataSourceId} role=${roleId}`,
    );
    this.name = "ProxyCredentialNotFoundError";
  }
}

export class ProxyDataSourceNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(dataSourceId: string) {
    super(`Data source not found: ${dataSourceId}`);
    this.name = "ProxyDataSourceNotFoundError";
  }
}

// ── Connector cache ────────────────────────────────────────────────────────────
// Stores the per-connector query function keyed by (tenantId:roleId:dataSourceId).
// When the stored credential hash changes the entry is replaced (detects rotation).
// `endFn` drains the underlying connection pool (pg/mysql) on cache eviction or
// test teardown — prevents uncaught exceptions when test containers stop.

type QueryFn = (q: ValidatedQuery) => Promise<QueryResult>;
type EndFn = () => Promise<void>;

interface CacheEntry {
  queryFn: QueryFn;
  endFn: EndFn | undefined;
  credHash: string;
}

const _cache = new Map<string, CacheEntry>();

function _cacheKey(
  tenantId: string,
  roleId: string,
  dataSourceId: string,
): string {
  return `${tenantId}:${roleId}:${dataSourceId}`;
}

function _hashCred(encryptedCred: string): string {
  return createHash("sha256").update(encryptedCred).digest("hex").slice(0, 16);
}

// ── Connector factory ──────────────────────────────────────────────────────────

interface ConnectorEntry {
  queryFn: QueryFn;
  /** Drain the underlying connection pool. Undefined for stateless connectors. */
  endFn: EndFn | undefined;
}

function _buildConnectorEntry(
  type: string,
  cred: Record<string, unknown>,
): ConnectorEntry {
  switch (type) {
    case "postgres": {
      const c = new PgConnector(cred as unknown as PgCredential);
      return { queryFn: (q) => c.query(q as SqlQuery), endFn: () => c.end() };
    }
    case "mysql": {
      const c = new MysqlConnector(cred as unknown as MysqlCredential);
      return { queryFn: (q) => c.query(q as SqlQuery), endFn: () => c.end() };
    }
    case "bigquery": {
      // BigQueryConnector is stateless (no persistent pool)
      const c = new BigQueryConnector(cred as unknown as BigQueryCredential);
      return { queryFn: (q) => c.query(q as SqlQuery), endFn: undefined };
    }
    case "rest": {
      // RestConnector is stateless (no persistent pool)
      const c = new RestConnector(cred as unknown as RestCredential);
      return { queryFn: (q) => c.query(q as RestQuery), endFn: undefined };
    }
    default:
      throw new ConnectorDataSourceError(
        `Unsupported data source type: ${type}`,
      );
  }
}

// ── Execute ────────────────────────────────────────────────────────────────────

export async function execute(args: ProxyArgs): Promise<QueryResult> {
  const { tenantId, roleId, dataSourceId, query } = args;

  // Step 1 — resolve data source type and encrypted credential from the
  // control-plane DB, scoped to the correct tenant schema via withTenant.
  // Decryption happens AFTER the tx closes so the plaintext never touches Prisma.
  const { type, encryptedCred } = await withTenant(tenantId, async (tx) => {
    const dsRows = await tx.$queryRawUnsafe<Array<{ type: string }>>(
      `SELECT type FROM data_sources WHERE id = $1`,
      dataSourceId,
    );
    if (!dsRows.length) {
      throw new ProxyDataSourceNotFoundError(dataSourceId);
    }

    const credRows = await tx.$queryRawUnsafe<
      Array<{ encrypted_cred: string }>
    >(
      `SELECT encrypted_cred
       FROM cred_vault_refs
       WHERE data_source_id = $1 AND role_id = $2`,
      dataSourceId,
      roleId,
    );
    if (!credRows.length) {
      throw new ProxyCredentialNotFoundError(dataSourceId, roleId);
    }

    return {
      type: dsRows[0].type,
      encryptedCred: credRows[0].encrypted_cred,
    };
  });

  // Step 2 — hit the connector cache; rebuild when credential hash changes.
  const key = _cacheKey(tenantId, roleId, dataSourceId);
  const hash = _hashCred(encryptedCred);
  let entry = _cache.get(key);

  if (!entry || entry.credHash !== hash) {
    // Drain the old pool before replacing — prevents orphaned connections on
    // credential rotation (CWE: resource exhaustion across tenants).
    // Wrapped in try/catch because endFn() may throw synchronously if the
    // underlying driver is already closed or the mock has no end() method.
    if (entry?.endFn) {
      try {
        void entry.endFn().catch(() => undefined);
      } catch {
        // suppress — drain failures must never block query execution
      }
    }
    // Decrypt in memory. `cred` must never be logged or returned to callers.
    const cred = decryptCredential(encryptedCred);
    const { queryFn, endFn } = _buildConnectorEntry(type, cred);
    entry = { queryFn, endFn, credHash: hash };
    _cache.set(key, entry);
  }

  // Step 3 — execute via raw driver. Prisma is never on this path.
  return entry.queryFn(query);
}

// ── Test helpers ───────────────────────────────────────────────────────────────

/** Clear the connector cache without draining pools. Only call in tests. */
export function _clearConnectorCache(): void {
  _cache.clear();
}

/**
 * Drain all cached connector pools then clear the cache.
 * Call in afterAll before stopping test containers so pg/mysql pools release
 * their connections cleanly — avoids uncaught "terminating connection" errors.
 */
export async function _drainConnectorCache(): Promise<void> {
  const drains = [..._cache.values()]
    .filter((e) => e.endFn !== undefined)
    .map((e) => e.endFn!().catch(() => undefined));
  await Promise.all(drains);
  _cache.clear();
}
