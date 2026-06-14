# Tech Stack — BI Result Presenter

> **Status: confirmed.** The stack below reflects user-confirmed decisions. The
> API framework is **Express** (was Fastify) and DB access is **Prisma** (was
> Drizzle); see the reconciliation note in §"Prisma + the credential model".

**Overarching choice: TypeScript end-to-end.** The repo lives under a `js/`
path, the product is streaming-chat-heavy (first-class in the JS ecosystem), and
sharing types across the frontend/backend seam (result envelope, RBAC model,
chat contracts) removes a whole class of integration bugs. Nothing *mandates*
JS/TS, but for this app it minimizes friction and lets frontend/backend tracks
share contracts directly.

## Per-component table

| # | Component | Chosen | Alternatives | One-line rationale |
|---|-----------|--------|--------------|--------------------|
| 1 | Language | **TypeScript (Node 20 LTS)** | Python (FastAPI), Go | One language across FE/BE; shared contract types; best-in-class streaming. |
| 2 | API framework | **Express 4** | Fastify, NestJS, Hono | Ubiquitous, simplest mental model, widest middleware ecosystem. No built-in schema validation and no SSE helper — paired with Zod validation middleware (18) and manual SSE response handling (see patterns `request-validation` + `streaming-sse`). |
| 3 | Frontend framework | **React 18 + Vite + TypeScript** | SvelteKit, Vue, Next.js | Largest charting/a11y ecosystem; Vite SPA fits a separate API; Next not needed (no SSR requirement). |
| 4 | Routing/state (FE) | **React Router + TanStack Query** | Redux Toolkit, Zustand | Query handles server-state + the client result cache for toggle/export; Router for the 11 screens. |
| 5 | UI styling | **Tailwind CSS + Radix UI primitives** | MUI, Chakra, plain CSS | Radix gives accessible (WCAG 2.1 AA) modals/drawers/tree out of the box; Tailwind maps cleanly to the design tokens. |
| 6 | Charting | **Recharts** | Chart.js, ECharts, Visx | React-native API for bar/line/pie/table; SVG enables `role="img"`/per-element ARIA per UI/UX §10. |
| 7 | Control-plane DB | **PostgreSQL 16** | MySQL, CockroachDB | Schema-per-tenant (`search_path`), strong RBAC/`GRANT` for the restricted-credential model, JSONB for flexible audit. |
| 8 | DB access/migrations (control plane only) | **Prisma + Prisma Migrate** | Drizzle, Knex, raw pg | Mature schema modeling + migrations + type-safe client for the **control plane** (tenants/roles/users/grants/conversations/audit). **Scope boundary:** Prisma is control-plane only; the data plane (tenant-source execution) never uses Prisma — see (12) and §"Prisma + the credential model". |
| 9 | LLM provider (default) | **Google Gemini** (locked) | OpenAI, Anthropic (via abstraction) | User-locked default; sits behind the swappable `LlmProvider` port. |
| 10 | LLM SDK | **`@google/genai`** (official) | raw REST | Official SDK; streaming support; wrapped by the Gemini adapter only. |
| 11 | SQL parsing (gate) | **`node-sql-parser`** | pgsql-parser (WASM), custom | Multi-dialect AST → extract referenced schema/table/column for the permission gate + validation. |
| 12 | Data-source connectors (data plane) | **`pg`, `mysql2`, `@google-cloud/bigquery`, `undici` (REST)** | knex multi-dialect, ORMs/Prisma | Direct, minimal **raw drivers** per v1 source type (GAP-16); the Query Proxy owns the connection + the least-privilege per-(tenant,role) credential. **Prisma is never used here** — data-plane execution must run on the restricted credential, not Prisma's pooled control-plane connection. |
| 13 | Streaming transport | **Server-Sent Events (SSE)** | WebSocket, HTTP chunked | One-way token stream fits chat; simpler than WS; works through proxies/CDN. |
| 14 | Auth | **Custom email+password (argon2) + OIDC via `openid-client`** | Auth0/Clerk, Lucia, NextAuth | Locked: email+password baseline + optional per-tenant SSO/OIDC; keeps tenant IdP config in-app. |
| 15 | Session/token | **Short-lived JWT access (~15m) + rotating refresh (httpOnly cookie)** | Opaque server sessions, long JWT | Short access TTL realizes GAP-17 (near-session permission propagation); refresh in httpOnly cookie. |
| 16 | Password hashing | **argon2id** | bcrypt, scrypt | Modern memory-hard default. |
| 17 | Secret / cred vault | **App-level envelope encryption via cloud KMS** (e.g. AES-256-GCM data keys) | HashiCorp Vault, plain env | Encrypts per-(tenant,role,source) data-source credentials; KMS-managed master key. |
| 18 | Validation/schemas | **Zod** | io-ts, Yup, AJV-only | Single source of truth for request/response + shared FE/BE contract types. **Load-bearing with Express:** Express has no built-in schema validation, so a Zod request-validation middleware guards every route body/params/query (patterns `request-validation`). |
| 19 | Testing | **Vitest + Supertest (API) + Playwright (E2E/a11y) + axe-core** | Jest, Cypress | Vitest matches Vite/TS; Playwright+axe verify WCAG 2.1 AA. See conventions/testing.md. |
| 20 | Observability | **OpenTelemetry (traces+metrics) + pino structured logs** | Datadog-only, Prometheus-only | Vendor-neutral; `monitor` agent wires concrete backend/alerts later. |
| 21 | Monorepo / tooling | **pnpm workspaces + Turborepo; ESLint + Prettier; tsup/tsx** | npm/yarn workspaces, Nx | `apps/web`, `apps/api`, `packages/contracts`; shared contract package across the seam. |
| 22 | Containerization | **Docker** (multi-stage) | Buildpacks | Standard, host-agnostic; SPA served via CDN/static, API as a container. |

## Notes / dependencies between choices

- (2)+(13)+(18): Express has neither built-in SSE nor schema validation. SSE is
  done by writing `text/event-stream` to the raw response (patterns `streaming-sse`);
  validation is a Zod middleware on every route (patterns `request-validation`).
- (4)+(13): TanStack Query caches the result envelope client-side → backs the
  chart↔table toggle and export with no re-query (GAP-13).
- (7)+(8)+(12)+(17): schema-per-tenant + per-(tenant,role) least-privilege
  credentials require strict separation. **Prisma (8) is control-plane only** and
  drives schema-per-tenant via a per-request pinned `search_path` on its own
  connection (see §"Prisma + the credential model"). **Data-plane execution (12)
  uses raw drivers under the restricted credential — never Prisma.** This boundary
  preserves the L2 backstop that a heavy ORM would otherwise weaken.
- (11) is security-critical: it powers the permission gate's resource extraction;
  for REST sources the gate uses the connector's declared endpoint/field schema.
- (9)+(10): only the Gemini adapter imports `@google/genai`; the pipeline depends
  on the `LlmProvider` port (patterns.md), keeping the provider swappable.

## Prisma + the credential model (reconciliation)

The original concern: a heavy ORM with a single datasource/connection string and
its own pool can break (a) schema-per-tenant `search_path` isolation and (b) the
L2 per-(tenant,role) least-privilege credential / Query Proxy. Resolved by a hard
**control-plane / data-plane split**:

- **Prisma = control plane only.** Prisma owns *only* the application's own
  Postgres: tenants, roles, users, resource_grants, conversations, messages,
  audit_events, cred-vault refs. It never touches a tenant data source.
- **Data plane = raw drivers under the restricted credential.** The Query Proxy
  executes generated tenant queries with `pg` / `mysql2` / `@google-cloud/bigquery`
  / `undici`, on a connection opened with the decrypted per-(tenant,role,source)
  least-privilege credential. **Prisma is never on this path** — so the L2 backstop
  (the data source itself rejecting anything beyond the role's grants) is fully
  intact; Prisma's pool is irrelevant to data-plane authorization.

### Schema-per-tenant under Prisma — chosen pattern

**Pattern: a single PrismaClient + per-request `search_path` pinned on a dedicated
interactive transaction connection.** On each request, after tenant resolution,
the control-plane work runs inside `prisma.$transaction(async (tx) => { await
tx.$executeRawUnsafe('SET LOCAL search_path TO "tenant_<id>", platform'); ... })`.
`SET LOCAL` scopes the `search_path` to that transaction's connection and Postgres
resets it automatically at commit/rollback — so the setting **cannot leak to the
next borrower of that pooled connection**.

- Rejected — **per-tenant PrismaClient cache:** each PrismaClient has its own
  pool; with many tenants this multiplies open connections and exhausts Postgres
  `max_connections`. Avoided.
- Rejected — **bare `$executeRawUnsafe('SET search_path')` outside a transaction:**
  `SET` (without `LOCAL`) persists on the pooled connection and leaks to the next
  request that borrows it. Avoided — see common-pitfalls "search_path leakage".

**Connection-pool implications:** one PrismaClient, one pool (size set via the
`connection_limit` datasource param), sized for the API instance count. Because
tenant scoping is per-transaction (`SET LOCAL`), pooled connections are safely
shared across tenants. The data-plane proxy maintains its **own**, separate pools
keyed by credential — independent of Prisma's pool budget.

## v1 data-source types (GAP-16 — Architect recommendation)

Minimal v1 set: **PostgreSQL, MySQL, BigQuery** (SQL) + **one generic REST shape**
(token-auth JSON API with a declared endpoint/field allow-list). MSSQL/Snowflake
deferred — adapter interface leaves room. Confirm with user.
