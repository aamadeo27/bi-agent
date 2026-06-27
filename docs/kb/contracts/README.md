# Contracts — index

Core API + data contracts at the frontend/backend seam. All shapes live in
`packages/contracts` as Zod schemas + inferred TS types (single source of truth).
Item anchors match `kb-refs` (`contracts: [chat-api, rbac-model, ...]`).

> Conventions: JSON over HTTPS; camelCase fields; ISO-8601 UTC timestamps; ids are
> opaque strings (ULID). All endpoints are tenant-scoped via the auth token.

---

- [chat-api](chat-api.md) — ### POST `/api/conversations/:conversationId/messages` (SSE response)
- [result-envelope](result-envelope.md) — Wraps every successful query result. Drives chart render, toggle, export.
- [permission-block](permission-block.md) — Returned on `event: block` when the gate denies (GAP-12 block+explain). No data.
- [rbac-model](rbac-model.md) — Control-plane schema (per-tenant schema; tenant scoping is structural).
- [generated-query-view](generated-query-view.md) — Returned by `GET /api/messages/:id/query` (Action D / FR-LLM-5).
- [audit-event](audit-event.md) — Persisted (GAP-9 confirmed). Powers Admin Audit Log (S8) and security review.
- [auth-api](auth-api.md) — - `POST /api/auth/login` → `{ accessToken }` + sets refresh cookie (httpOnly).
- [error-codes](error-codes.md) — Discriminated union shared FE/BE:
- [datasource-connector](datasource-connector.md) — `Connector<Q>` interface every data-source adapter implements (SQL T4.2, REST T4.3). Owns the interface.
