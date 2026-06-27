## datasource-connector

layer: backend

The shared `Connector` interface every data-source adapter implements. SQL adapters
(T4.2) and the REST adapter (T4.3) implement it; the Query Proxy (T4.4) calls through
it. **This contract owns the interface** — its canonical source is
`apps/api/src/datasource/connector.ts`.

```ts
// apps/api/src/datasource/connector.ts
import type { SchemaTree, ColumnType } from "@bi/contracts";

interface QueryColumn {
  name: string;
  type: ColumnType;                                 // see result-envelope
  role: "dimension" | "measure" | "time";
}

interface QueryResult {                             // pre-envelope; T5.x wraps into ResultEnvelope
  columns: QueryColumn[];
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;                                 // total rows produced
  truncated: boolean;                               // true if cap hit
}

interface RestQuery {                               // the default Q (REST adapter, T4.3)
  kind: "rest";
  endpoint: string;                                 // must match a declared allow-listed endpoint
  params?: Record<string, string>;
  fields?: string[];                                // subset of the endpoint's declared fields
}

interface Connector<Q = RestQuery> {
  testConnection(): Promise<void>;                  // throws ConnectorDataSourceError on failure
  introspect(dataSourceId: string): Promise<SchemaTree>;
  query(q: Q): Promise<QueryResult>;
}
```

### Method contract
- `testConnection(): Promise<void>` — smoke-test the connection. Resolves on success;
  **throws `ConnectorDataSourceError`** on failure (no boolean return).
- `introspect(dataSourceId): Promise<SchemaTree>` — return the schema tree
  (schema > table > column + types) consumed by the grant editor and T3.2's
  `GET /api/admin/schema/:id` endpoint.
- `query(q: Q): Promise<QueryResult>` — execute a validated, allow-listed query and
  return raw result data in the `QueryResult` shape (columns/rows/rowCount/truncated).

### The generic `Q` query-input pattern
Each adapter family picks its own query-input type and implements `Connector<Q>` with it:
- REST adapter implements `Connector<RestQuery>` (`Q` defaults to `RestQuery`).
- SQL adapters define `SqlQuery` and implement `Connector<SqlQuery>` (T4.2).

Connection lifecycle (pooling, connect/disconnect) is **internal to the adapter** — it is
deliberately absent from the interface.

### Ownership rule
This contract owns the `Connector<Q>` interface. Adapter tasks **implement** it; they must
**not** redefine the interface or edit the interface block (or its `QueryResult` /
`QueryColumn` / `RestQuery` types) in `apps/api/src/datasource/connector.ts`. A new adapter:
- adds its own source file under `apps/api/src/datasource/` (e.g. `pg-connector.ts`), and
- **APPENDS** only its own exports to the barrel `apps/api/src/datasource/index.ts`.

This keeps parallel adapter tasks in genuinely distinct files (no shared-interface merge
conflict).
