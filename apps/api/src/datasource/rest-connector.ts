/**
 * Generic REST Connector — Bearer-token auth, declared endpoint/field allow-list.
 *
 * Security model (L2 backstop):
 *   - Only paths listed in `endpoints` are reachable; others are rejected before
 *     any network call (VALIDATION error).
 *   - Only fields listed per endpoint are returned; extra fields from the server
 *     response are stripped before normalization.
 *   - A requested field subset must be within the endpoint's declared list.
 *
 * Schema mapping onto ResourceGrant (schema/table/column):
 *   schema  → "rest"       (fixed sentinel for REST data sources)
 *   table   → endpoint path (e.g. "/api/sales")
 *   column  → field name
 */
import { request } from "undici";
import type { SchemaTree, ColumnType } from "@bi/contracts";
import type {
  Connector,
  QueryResult,
  QueryColumn,
  RestQuery,
} from "./connector.js";

// ── Constants ──────────────────────────────────────────────────────────────────

export const REST_SCHEMA_NAME = "rest";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Credential shape ───────────────────────────────────────────────────────────

/** A single allow-listed endpoint with its permitted field names. */
export interface EndpointDecl {
  /** Absolute path, e.g. "/api/v1/sales". Must start with "/". */
  path: string;
  /** Fields from the JSON response that the connector may expose. */
  fields: string[];
}

/** Decrypted credential stored in the vault for a REST data source. */
export interface RestCredential {
  /** Base URL without trailing slash, e.g. "https://api.example.com". */
  baseUrl: string;
  /** Bearer token sent in every request. Never logged. */
  token: string;
  /** Declared allow-list; drives schema introspection and request validation. */
  endpoints: EndpointDecl[];
}

/** Constructor options for overriding defaults (primarily for testing). */
export interface RestConnectorOptions {
  timeoutMs?: number;
  maxRows?: number;
  maxResponseBytes?: number;
}

// ── Typed errors ───────────────────────────────────────────────────────────────

/** Thrown when a request violates the allow-list. Maps to VALIDATION error code. */
export class ConnectorValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConnectorValidationError";
  }
}

/** Thrown when the upstream server fails or the response is unusable. */
export class ConnectorDataSourceError extends Error {
  readonly code = "DATA_SOURCE" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConnectorDataSourceError";
  }
}

// ── Type inference helpers ─────────────────────────────────────────────────────

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inferType(value: unknown): ColumnType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    if (ISO_DATETIME_RE.test(value)) return "datetime";
    if (ISO_DATE_RE.test(value)) return "date";
  }
  return "string";
}

function inferRole(type: ColumnType): QueryColumn["role"] {
  if (type === "number" || type === "integer") return "measure";
  if (type === "date" || type === "datetime") return "time";
  return "dimension";
}

// ── Row extraction ─────────────────────────────────────────────────────────────

/**
 * Extract a row array from parsed JSON.
 * Handles: top-level array, object with first array property, single object.
 */
function extractRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[];
  }
  if (parsed !== null && typeof parsed === "object") {
    for (const val of Object.values(parsed as object)) {
      if (Array.isArray(val)) return val as Record<string, unknown>[];
    }
    return [parsed as Record<string, unknown>];
  }
  return [];
}

// ── Value normalization ────────────────────────────────────────────────────────

function normalizeValue(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return val;
  if (typeof val === "string") return val;
  // Arrays / objects: JSON stringify to a string
  return JSON.stringify(val);
}

// ── RestConnector ──────────────────────────────────────────────────────────────

export class RestConnector implements Connector<RestQuery> {
  private readonly timeoutMs: number;
  private readonly maxRows: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly cred: RestCredential,
    opts: RestConnectorOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    this.maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  }

  // ── testConnection ──────────────────────────────────────────────────────────

  async testConnection(): Promise<void> {
    const url = this.cred.baseUrl.replace(/\/$/, "");
    try {
      const res = await request(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.cred.token}` },
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
      });
      // Consume body to avoid socket leaks.
      await res.body.dump();
      // 5xx = server-side problem; 4xx = auth/path (server is up — acceptable for test).
      if (res.statusCode >= 500) {
        throw new ConnectorDataSourceError(
          `Server returned HTTP ${res.statusCode}`,
        );
      }
    } catch (err) {
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Connection failed: ${(err as Error).message}`,
      );
    }
  }

  // ── introspect ──────────────────────────────────────────────────────────────

  async introspect(dataSourceId: string): Promise<SchemaTree> {
    const tables = this.cred.endpoints.map((ep) => ({
      name: ep.path,
      columns: ep.fields.map((f) => ({ name: f, type: "string" })),
    }));
    return {
      dataSourceId,
      schemas: [{ name: REST_SCHEMA_NAME, tables }],
    };
  }

  // ── query ───────────────────────────────────────────────────────────────────

  async query(q: RestQuery): Promise<QueryResult> {
    // ── 1. Endpoint allow-list ──────────────────────────────────────────────
    const ep = this.cred.endpoints.find((e) => e.path === q.endpoint);
    if (!ep) {
      throw new ConnectorValidationError(
        `Endpoint not in allow-list: ${q.endpoint}`,
      );
    }

    // ── 2. Field allow-list ─────────────────────────────────────────────────
    const requestedFields = q.fields ?? ep.fields;
    const disallowed = requestedFields.filter((f) => !ep.fields.includes(f));
    if (disallowed.length > 0) {
      throw new ConnectorValidationError(
        `Fields not in allow-list: ${disallowed.join(", ")}`,
      );
    }

    // ── 3. Build URL ────────────────────────────────────────────────────────
    const base = this.cred.baseUrl.replace(/\/$/, "");
    const params = q.params && Object.keys(q.params).length > 0
      ? "?" + new URLSearchParams(q.params).toString()
      : "";
    const url = `${base}${q.endpoint}${params}`;

    // ── 4. Fetch ────────────────────────────────────────────────────────────
    let statusCode: number;
    let body: AsyncIterable<Uint8Array>;
    try {
      const res = await request(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.cred.token}` },
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
      });
      statusCode = res.statusCode;
      body = res.body;
    } catch (err) {
      throw new ConnectorDataSourceError(
        `Request failed: ${(err as Error).message}`,
      );
    }

    if (statusCode < 200 || statusCode >= 300) {
      // Drain body to release socket before throwing.
      for await (const _ of body) { /* drain */ }
      throw new ConnectorDataSourceError(
        `REST endpoint returned HTTP ${statusCode}`,
      );
    }

    // ── 5. Read response with byte cap ──────────────────────────────────────
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const chunk of body) {
        totalBytes += chunk.length;
        if (totalBytes > this.maxResponseBytes) {
          throw new ConnectorDataSourceError(
            `Response exceeds ${this.maxResponseBytes}-byte cap`,
          );
        }
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      if (err instanceof ConnectorDataSourceError) throw err;
      throw new ConnectorDataSourceError(
        `Error reading response body: ${(err as Error).message}`,
      );
    }

    // ── 6. Parse JSON ───────────────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ConnectorDataSourceError(
        "REST endpoint returned non-JSON response",
      );
    }

    // ── 7. Extract + filter rows ────────────────────────────────────────────
    const rawRows = extractRows(parsed);
    const allowedSet = new Set(requestedFields);
    const filteredRows = rawRows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([k]) => allowedSet.has(k)),
      ),
    );

    // ── 8. Infer columns from first row (or fall back to declared order) ────
    const sample = filteredRows[0] ?? {};
    const columns: QueryColumn[] = requestedFields.map((field) => {
      const type = inferType(sample[field]);
      return { name: field, type, role: inferRole(type) };
    });

    // ── 9. Apply row cap ────────────────────────────────────────────────────
    const rowCount = filteredRows.length;
    const truncated = rowCount > this.maxRows;
    const cappedRows = truncated ? filteredRows.slice(0, this.maxRows) : filteredRows;

    // ── 10. Normalize row values ────────────────────────────────────────────
    const rows = cappedRows.map((row) =>
      Object.fromEntries(requestedFields.map((f) => [f, normalizeValue(row[f])])),
    );

    return { columns, rows, rowCount, truncated };
  }
}
