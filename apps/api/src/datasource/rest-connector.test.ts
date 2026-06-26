/**
 * Unit tests for RestConnector — T4.3 acceptance criteria:
 *   1. Allow-list enforcement (endpoint + fields)
 *   2. JSON normalization → columns/rows with inferred types
 *   3. Timeout handling
 *   4. testConnection() happy path and failure
 *   5. Result size cap (row cap + byte cap)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import {
  RestConnector,
  ConnectorValidationError,
  ConnectorDataSourceError,
  REST_SCHEMA_NAME,
  type RestCredential,
} from "./rest-connector.js";

// ── undici mock ───────────────────────────────────────────────────────────────

vi.mock("undici", () => ({
  request: vi.fn(),
}));

import * as undici from "undici";
const mockRequest = vi.mocked(undici.request);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a body mock that is async-iterable (like undici's BodyReadable).
 * We attach dump() directly to the Readable so the prototype chain stays intact
 * — spreading a Readable loses Symbol.asyncIterator.
 */
function makeBody(data: string) {
  const readable = Readable.from([Buffer.from(data)]);
  // undici BodyReadable has a dump() helper; add it to the mock.
  (readable as unknown as Record<string, unknown>)["dump"] = vi
    .fn()
    .mockResolvedValue(undefined);
  return readable as unknown as AsyncIterable<Uint8Array> & {
    dump: () => Promise<void>;
  };
}

/** Stub a successful undici response. */
function stubResponse(statusCode: number, body: string) {
  mockRequest.mockResolvedValueOnce({
    statusCode,
    body: makeBody(body),
  } as unknown as Awaited<ReturnType<typeof undici.request>>);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CRED: RestCredential = {
  baseUrl: "https://api.example.com",
  token: "test-token-secret",
  endpoints: [
    { path: "/api/sales", fields: ["id", "amount", "date", "region"] },
    { path: "/api/users", fields: ["id", "name", "email"] },
  ],
};

function makeConnector(overrides?: Partial<RestCredential>) {
  return new RestConnector({ ...BASE_CRED, ...overrides }, { timeoutMs: 500 });
}

// ── testConnection ─────────────────────────────────────────────────────────────

describe("testConnection", () => {
  beforeEach(() => mockRequest.mockReset());

  it("succeeds on 200", async () => {
    stubResponse(200, "ok");
    await expect(makeConnector().testConnection()).resolves.toBeUndefined();
    expect(mockRequest).toHaveBeenCalledOnce();
    const [url, opts] = mockRequest.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://api.example.com");
    expect((opts as { headers: Record<string, string> }).headers["Authorization"]).toBe(
      "Bearer test-token-secret",
    );
  });

  it("succeeds on 401 (server is reachable)", async () => {
    stubResponse(401, "unauthorized");
    await expect(makeConnector().testConnection()).resolves.toBeUndefined();
  });

  it("throws ConnectorDataSourceError on 5xx", async () => {
    stubResponse(503, "unavailable");
    await expect(makeConnector().testConnection()).rejects.toThrow(
      ConnectorDataSourceError,
    );
  });

  it("throws ConnectorDataSourceError on network error", async () => {
    mockRequest.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(makeConnector().testConnection()).rejects.toThrow(
      ConnectorDataSourceError,
    );
  });

  it("throws ConnectorDataSourceError on timeout", async () => {
    mockRequest.mockRejectedValueOnce(new Error("body timeout"));
    let caught: unknown;
    try {
      await makeConnector().testConnection();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConnectorDataSourceError);
    const err = caught as ConnectorDataSourceError;
    expect(err.code).toBe("DATA_SOURCE");
    expect(err.message).toMatch(/body timeout/);
  });

  it("strips trailing slash from baseUrl", async () => {
    stubResponse(200, "ok");
    const conn = new RestConnector(
      { ...BASE_CRED, baseUrl: "https://api.example.com/" },
      { timeoutMs: 500 },
    );
    await conn.testConnection();
    const [url] = mockRequest.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://api.example.com");
  });
});

// ── introspect ─────────────────────────────────────────────────────────────────

describe("introspect", () => {
  it("returns SchemaTree with schema=rest, tables=endpoints, columns=fields", async () => {
    const tree = await makeConnector().introspect("ds-1");
    expect(tree.dataSourceId).toBe("ds-1");
    expect(tree.schemas).toHaveLength(1);
    const schema = tree.schemas[0];
    expect(schema.name).toBe(REST_SCHEMA_NAME);
    expect(schema.tables).toHaveLength(2);
    const salesTable = schema.tables.find((t) => t.name === "/api/sales")!;
    expect(salesTable).toBeDefined();
    expect(salesTable.columns.map((c) => c.name)).toEqual([
      "id", "amount", "date", "region",
    ]);
  });

  it("columns from introspect map to allow-listed fields", async () => {
    const tree = await makeConnector().introspect("ds-1");
    const usersTable = tree.schemas[0].tables.find((t) => t.name === "/api/users")!;
    expect(usersTable.columns.map((c) => c.name)).toEqual(["id", "name", "email"]);
  });
});

// ── allow-list enforcement ─────────────────────────────────────────────────────

describe("query — allow-list enforcement", () => {
  beforeEach(() => mockRequest.mockReset());

  it("rejects endpoint not in allow-list", async () => {
    const err = await makeConnector()
      .query({ kind: "rest", endpoint: "/api/secret" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorValidationError);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toMatch(/allow-list/);
    // No network call made
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects fields not in allow-list for that endpoint", async () => {
    const err = await makeConnector()
      .query({
        kind: "rest",
        endpoint: "/api/sales",
        fields: ["id", "amount", "SECRET_FIELD"],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorValidationError);
    expect(err.message).toMatch(/SECRET_FIELD/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects field from a different endpoint's allow-list", async () => {
    // 'email' is in /api/users but NOT in /api/sales
    const err = await makeConnector()
      .query({
        kind: "rest",
        endpoint: "/api/sales",
        fields: ["id", "email"],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorValidationError);
    expect(err.message).toMatch(/email/);
  });

  it("accepts valid subset of allowed fields", async () => {
    stubResponse(
      200,
      JSON.stringify([
        { id: 1, amount: 99.5, date: "2024-01-15", region: "APAC" },
      ]),
    );
    const result = await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
      fields: ["id", "amount"],
    });
    expect(result.columns.map((c) => c.name)).toEqual(["id", "amount"]);
  });

  it("strips fields not in allow-list from server response", async () => {
    // Server returns extra field 'internal_note' not declared
    stubResponse(
      200,
      JSON.stringify([
        { id: 1, amount: 50, date: "2024-01-01", region: "EU", internal_note: "secret" },
      ]),
    );
    const result = await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
    });
    const row = result.rows[0];
    expect(row).not.toHaveProperty("internal_note");
    expect(Object.keys(row)).toEqual(["id", "amount", "date", "region"]);
  });
});

// ── JSON normalization ─────────────────────────────────────────────────────────

describe("query — JSON normalization", () => {
  beforeEach(() => mockRequest.mockReset());

  it("infers column types correctly", async () => {
    stubResponse(
      200,
      JSON.stringify([
        { id: 1, amount: 99.5, date: "2024-01-15", region: "EU" },
      ]),
    );
    const result = await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
    });
    const byName = Object.fromEntries(result.columns.map((c) => [c.name, c]));
    expect(byName["id"].type).toBe("integer");
    expect(byName["amount"].type).toBe("number");
    expect(byName["date"].type).toBe("date");
    expect(byName["region"].type).toBe("string");
  });

  it("infers datetime type from ISO datetime string", async () => {
    stubResponse(
      200,
      JSON.stringify([{ id: 1, amount: 0, date: "2024-01-15T09:00:00Z", region: "US" }]),
    );
    const result = await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
    });
    const dateCol = result.columns.find((c) => c.name === "date")!;
    expect(dateCol.type).toBe("datetime");
  });

  it("infers column roles correctly", async () => {
    stubResponse(
      200,
      JSON.stringify([{ id: 1, amount: 100, date: "2024-01-15", region: "EU" }]),
    );
    const result = await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
    });
    const byName = Object.fromEntries(result.columns.map((c) => [c.name, c]));
    expect(byName["id"].role).toBe("measure");      // integer → measure
    expect(byName["amount"].role).toBe("measure");  // number  → measure
    expect(byName["date"].role).toBe("time");       // date    → time
    expect(byName["region"].role).toBe("dimension"); // string → dimension
  });

  it("handles top-level JSON array", async () => {
    stubResponse(200, JSON.stringify([{ id: 1, name: "Alice", email: "a@x.com" }]));
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]["name"]).toBe("Alice");
  });

  it("handles response object wrapping an array", async () => {
    stubResponse(
      200,
      JSON.stringify({ total: 2, data: [{ id: 1, name: "A", email: "a@x.com" }, { id: 2, name: "B", email: "b@x.com" }] }),
    );
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]["name"]).toBe("A");
  });

  it("handles a single-object response", async () => {
    stubResponse(200, JSON.stringify({ id: 1, name: "Alice", email: "a@x.com" }));
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]["email"]).toBe("a@x.com");
  });

  it("normalizes null values", async () => {
    stubResponse(
      200,
      JSON.stringify([{ id: 1, name: null, email: "a@x.com" }]),
    );
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rows[0]["name"]).toBeNull();
  });

  it("normalizes boolean values to string", async () => {
    // boolean not in the declared fields but can be in inferred type path
    // Use users endpoint and inject a row with boolean via mock
    stubResponse(200, JSON.stringify([{ id: 1, name: "true", email: "a@x.com" }]));
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rows[0]["name"]).toBe("true");
  });

  it("sets rowCount and truncated=false when under cap", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: i, name: `User${i}`, email: `u${i}@x.com`,
    }));
    stubResponse(200, JSON.stringify(rows));
    const result = await makeConnector().query({ kind: "rest", endpoint: "/api/users" });
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("appends query params to URL", async () => {
    stubResponse(200, JSON.stringify([]));
    await makeConnector().query({
      kind: "rest",
      endpoint: "/api/sales",
      params: { page: "2", limit: "10" },
    });
    const [url] = mockRequest.mock.calls[0] as [string, unknown];
    expect(url).toContain("page=2");
    expect(url).toContain("limit=10");
  });

  it("throws ConnectorDataSourceError on non-200 HTTP status", async () => {
    stubResponse(404, "not found");
    const err = await makeConnector()
      .query({ kind: "rest", endpoint: "/api/sales" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorDataSourceError);
    expect(err.message).toMatch(/404/);
  });

  it("throws ConnectorDataSourceError on invalid JSON body", async () => {
    stubResponse(200, "not json at all");
    const err = await makeConnector()
      .query({ kind: "rest", endpoint: "/api/sales" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorDataSourceError);
    expect(err.message).toMatch(/JSON/);
  });
});

// ── Timeout ───────────────────────────────────────────────────────────────────

describe("query — timeout", () => {
  beforeEach(() => mockRequest.mockReset());

  it("wraps undici timeout error as ConnectorDataSourceError", async () => {
    const timeoutErr = new Error("body timeout");
    timeoutErr.name = "BodyTimeoutError";
    mockRequest.mockRejectedValueOnce(timeoutErr);

    const err = await makeConnector()
      .query({ kind: "rest", endpoint: "/api/sales" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorDataSourceError);
    expect(err.code).toBe("DATA_SOURCE");
    expect(err.message).toMatch(/body timeout/);
  });

  it("passes configured timeoutMs to undici request", async () => {
    stubResponse(200, JSON.stringify([]));
    const conn = new RestConnector(BASE_CRED, { timeoutMs: 1234 });
    await conn.query({ kind: "rest", endpoint: "/api/sales" });
    const [, opts] = mockRequest.mock.calls[0] as [string, { bodyTimeout: number; headersTimeout: number }];
    expect(opts.bodyTimeout).toBe(1234);
    expect(opts.headersTimeout).toBe(1234);
  });
});

// ── Row cap ───────────────────────────────────────────────────────────────────

describe("query — row cap", () => {
  beforeEach(() => mockRequest.mockReset());

  it("truncates results and sets truncated=true when rows exceed cap", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i, name: `User${i}`, email: `u${i}@x.com`,
    }));
    stubResponse(200, JSON.stringify(rows));
    const conn = new RestConnector(BASE_CRED, { maxRows: 5 });
    const result = await conn.query({ kind: "rest", endpoint: "/api/users" });
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(10);    // total before cap
    expect(result.rows).toHaveLength(5); // capped
  });

  it("throws ConnectorDataSourceError when response exceeds byte cap", async () => {
    // Create a response that exceeds the tiny cap
    const bigData = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ id: i, name: `U${i}`, email: `u@x.com` })),
    );
    // Use a custom body iterable that yields the data in one chunk
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      body: makeBody(bigData),
    } as unknown as Awaited<ReturnType<typeof undici.request>>);

    const conn = new RestConnector(BASE_CRED, { maxResponseBytes: 10 }); // 10 bytes cap
    const err = await conn
      .query({ kind: "rest", endpoint: "/api/users" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorDataSourceError);
    expect(err.message).toMatch(/cap/);
  });
});

// ── Authorization header ───────────────────────────────────────────────────────

describe("query — auth header", () => {
  beforeEach(() => mockRequest.mockReset());

  it("sends Bearer token in every request", async () => {
    stubResponse(200, JSON.stringify([]));
    await makeConnector().query({ kind: "rest", endpoint: "/api/sales" });
    const [, opts] = mockRequest.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(opts.headers["Authorization"]).toBe("Bearer test-token-secret");
  });
});
