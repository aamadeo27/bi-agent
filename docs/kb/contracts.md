# Contracts — BI Result Presenter

Core API + data contracts at the frontend/backend seam. All shapes live in
`packages/contracts` as Zod schemas + inferred TS types (single source of truth).
Item anchors match `kb-refs` (`contracts: [chat-api, rbac-model, ...]`).

> Conventions: JSON over HTTPS; camelCase fields; ISO-8601 UTC timestamps; ids are
> opaque strings (ULID). All endpoints are tenant-scoped via the auth token.

---

## chat-api

### POST `/api/conversations/:conversationId/messages` (SSE response)
Submit a question; response is an SSE stream (`Content-Type: text/event-stream`).

Request body:
```jsonc
{ "text": "Show me sales by region last quarter" }
```

SSE events (each `data:` is JSON of the named shape):
```jsonc
// event: meta   — sent once before/with first content
{ "messageId": "...", "queryType": "sql" | "rest" }
// event: token  — repeated; text delta
{ "delta": "..." }
// event: result — sent once when data is ready
{ "envelope": ResultEnvelope }            // see result-envelope
// event: block  — sent instead of result on permission block
{ "block": PermissionBlock }              // see below
// event: error  — terminal error
{ "code": ErrorCode, "message": "..." }
// event: done   — terminal success
{ "messageId": "..." }
```

### Other chat/conversation endpoints
- `GET  /api/conversations` → list (id, title, updatedAt) tenant+user scoped.
- `POST /api/conversations` → create empty conversation.
- `GET  /api/conversations/:id/messages` → history (durable; auto-purged after the
  365-day retention default — GAP-4 resolved).
- `DELETE /api/conversations/:id` → manual user delete (removes the conversation and
  its messages immediately; complements the scheduled auto-purge).
- `GET  /api/messages/:id/query` → inspect generated query (Action D); 403 unless
  the user's role has `canInspectQuery`. Returns `GeneratedQueryView`.

> **Retention (GAP-4 resolved):** conversations + messages carry a `createdAt`
> timestamp; a scheduled purge job hard-deletes any conversation older than the
> **365-day** default retention. Users may also delete a conversation manually at
> any time via `DELETE /api/conversations/:id`. No new API surface is required for
> the purge — it runs server-side on a schedule.

---

## result-envelope

Wraps every successful query result. Drives chart render, toggle, export.
```ts
interface ResultEnvelope {
  messageId: string;
  queryType: "sql" | "rest";
  chartType: "bar" | "line" | "pie" | "table";   // server auto-selected (UI/UX §9)
  columns: Array<{ name: string; type: ColumnType; role: "dimension" | "measure" | "time" }>;
  rows: Array<Record<string, string | number | null>>; // capped at row cap (GAP-8)
  rowCount: number;            // total rows the query produced
  truncated: boolean;          // true if rowCount > returned rows (cap hit)
  notes?: string;              // e.g. "downgraded to table: >2000 rows"
}
type ColumnType = "string" | "number" | "integer" | "boolean" | "date" | "datetime";
```
- Toggle/export consume this client-side cache (no re-query — GAP-13).
- `chartType` selection rules per UI/UX §9; server is authoritative, UI badge mirrors it.

---

## permission-block

Returned on `event: block` when the gate denies (GAP-12 block+explain). No data.
```ts
interface PermissionBlock {
  messageId: string;
  roleName: string;
  missing: Array<{
    kind: "schema" | "table" | "column";
    identifier: string;        // "sales.orders" or "sales.orders.revenue"
    accessNeeded: "read";      // only read in v1
  }>;
}
```

---

## rbac-model

Control-plane schema (per-tenant schema; tenant scoping is structural).

```ts
interface Role {
  id: string;
  name: string;                // unique within tenant, ≤64 chars
  description?: string;        // ≤256
  capabilities: { canInspectQuery: boolean }; // per-role toggle (GAP-1 locked); default false
  createdAt: string; updatedAt: string;
}

interface ResourceGrant {        // additive; absence = no access
  roleId: string;
  dataSourceId: string;
  kind: "schema" | "table" | "column";
  schema: string;
  table?: string;              // required for table/column
  column?: string;             // required for column
}
type ResourceGrantSet = ResourceGrant[]; // effective grants for a role

interface User {
  id: string; email: string; displayName: string;
  status: "invited" | "active" | "suspended";
  roleId: string | null;       // single role per user in v1 (confirmed) — effective grants resolve from this one role
  authMethods: Array<"password" | "sso">;
  createdAt: string;
}

interface DataSource {
  id: string; name: string;
  type: "postgres" | "mysql" | "bigquery" | "rest";  // GAP-16 v1 set
  status: "connected" | "error" | "unconfigured";
  lastTestedAt?: string;
  // connection config + credentials stored encrypted (vault); never returned in API.
}
```

### RBAC / admin endpoints
- `GET/POST/PATCH/DELETE /api/admin/roles[/:id]` — role CRUD (FR-AC-1,2).
- `GET/PUT /api/admin/roles/:id/grants` — read/replace grant set in a batch (FR-AC-3; matches S5 "Save changes").
- `GET /api/admin/schema/:dataSourceId` — schema tree (schema>table>column+types) for the editor.
- `GET/PATCH /api/admin/users[/:id]` — list, assign role, suspend (FR-AC-7).
- `POST /api/admin/users/invite` — email invite (auth-flow).
- `GET/POST/PATCH/DELETE /api/admin/data-sources[/:id]` + `POST .../:id/test` (S7).
- `GET /api/admin/audit` — filtered, paginated audit events (S8; GAP-9 confirmed).

All `/api/admin/*` require an admin-capable role; non-admins get `TENANT`/`AUTH` errors.

---

## generated-query-view

Returned by `GET /api/messages/:id/query` (Action D / FR-LLM-5).
```ts
interface GeneratedQueryView {
  messageId: string;
  queryType: "sql" | "rest";
  queryText: string;           // SQL text or REST endpoint+payload (read-only)
  dataSourceName: string;
  executedAt: string;
  rowCount: number;
}
```

---

## audit-event

Persisted (GAP-9 confirmed). Powers Admin Audit Log (S8) and security review.
Audit retention follows the GAP-4 365-day default (purged by the same/parallel job).
```ts
interface AuditEvent {
  id: string; tenantId: string;
  at: string;                  // ISO-8601 UTC
  actorUserId: string; roleNameAtEvent: string;
  type: "query_executed" | "query_blocked" | "query_validation_failed"
      | "export" | "role_changed" | "permission_changed"
      | "user_role_assigned" | "data_source_changed" | "login" | "login_failed";
  outcome: "success" | "blocked" | "error";
  dataSourceId?: string;
  detail: Record<string, unknown>; // e.g. { queryText, missing[], rowCount } — no row data
  ip?: string;
}
```
- `query_blocked` records the `missing[]` resources, not the data.
- `detail` must never contain queried row values (PII guard).

---

## auth-api

- `POST /api/auth/login` → `{ accessToken }` + sets refresh cookie (httpOnly).
- `POST /api/auth/refresh` → rotates tokens (realizes GAP-17 near-session propagation).
- `POST /api/auth/logout` → revokes refresh.
- `GET  /api/auth/sso/:tenant/start` + `/callback` → OIDC code flow (openid-client).
- `POST /api/auth/invite/accept` → set password / link SSO from invite token.
- `GET  /api/me` → `{ user, role, capabilities, tenant }` for the SPA shell.

Access token claims: `{ sub: userId, tenantId, roleId, exp (~15m) }`.

---

## error-codes

Discriminated union shared FE/BE:
`GATE_BLOCK | CLARIFICATION | VALIDATION | DATA_SOURCE | LLM_ERROR | AUTH | TENANT | NOT_FOUND | RATE_LIMIT | INTERNAL`.
Each maps to a UI/UX §11 state. `GATE_BLOCK` carries `PermissionBlock`;
`CLARIFICATION` carries the streamed clarification text.
