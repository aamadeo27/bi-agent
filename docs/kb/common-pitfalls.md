# Common pitfalls — BI Result Presenter

Read before working on the ask pipeline, RBAC, tenancy, or streaming. The
`kb-curator` may extend this from real incidents.

## Security gate bypass
- **Trusting the LLM's self-reported referenced resources.** Always re-derive
  referenced schema/table/column from the query AST in the gate. The model's claim
  is advisory only.
- **Filter-after-fetch.** Never execute then filter. The gate runs *before*
  execution; on any missing resource, block the whole query (no subsetting) — GAP-12.
- **Regex-based resource extraction.** Use a real SQL parser; regex misses aliases,
  CTEs, subqueries, qualified/unqualified columns. Fail closed on unresolved names.
- **Skipping the gate on follow-ups.** Every follow-up re-runs the gate; a prior
  turn's authorization is never reused.
- **Forgetting the credential backstop.** The gate (L1) is not enough; the
  restricted per-role credential (L2) must independently be unable to exceed grants.

## Tenant leakage
- **Trusting client-supplied tenant/role ids.** Tenant + role come only from the
  validated token. Reject bodies that name another tenant's ids.
- **A query without `search_path`/tenant scope set.** Every data-plane and
  control-plane access must run inside the resolved tenant context.
- **Shared caches keyed without tenant.** Any cache key includes `tenantId`.
- **Leaking tenant ids in errors/logs** of a different tenant.

## LLM injection / prompt safety
- **Sending row data or sample values to the model.** Only schema metadata +
  conversation text go to Gemini (GAP-18). No PII in prompts.
- **Letting model output reach a data source unvalidated.** Validator allow-lists
  SELECT/read verbs, rejects DDL/DML, multi-statement, comment-hidden statements.
- **Echoing literals back into the next prompt.** Strip queried values before they
  re-enter context on a follow-up.

## Streaming / back-pressure
- **No abort on client disconnect.** Cancel the upstream LLM stream when the SSE
  client disconnects, or you leak tokens, cost, and connections.
- **Unbounded server buffering** for slow consumers. Use a bounded queue.
- **Missing terminal event.** Always emit `done` or `error`; the UI hangs otherwise.

## Result handling / export
- **Re-querying on chart↔table toggle.** Toggle reads the client cache (GAP-13).
- **Exporting data the user couldn't see.** Export serializes only the already-
  authorized result envelope — never a fresh, wider query.
- **Charting huge result sets.** Respect the row cap + table-downgrade threshold
  (GAP-8) or the chart is illegible/slow.

## RBAC / permissions
- **Assuming row predicates exist.** Row-level is out of scope; grants stop at
  column. Don't build or rely on row filters.
- **Stale permissions mid-session.** Changes apply on token refresh (~15m, GAP-17);
  don't promise instant revocation, and don't cache grants past the token's life.
- **Tri-state UI desync.** Column-level un-grants under a granted table must persist
  as explicit grant rows; don't infer columns purely from the table grant.

## Auth
- **Long-lived access tokens.** Keep access TTL short; refresh rotates. Long tokens
  break GAP-17 propagation and widen the blast radius.
- **Storing refresh in localStorage.** Refresh lives in an httpOnly Secure cookie.

## Data-source connectors

- **Credential fields in API responses.** `config_encrypted` must be excluded from
  every `SELECT` column list — never use `SELECT *` on the `data_sources` table.
  `connectionConfig` / `config_encrypted` are write-only: accepted on POST/PATCH,
  never returned in GET. Response mappers must omit them explicitly. A stray wildcard
  leaks encrypted blobs (and signals to an attacker that a blob exists).
  First seen: T4.1.

- **Row cap via direct `LIMIT` on user SQL.** Don't append `LIMIT cap` to the
  original SQL — it conflicts with an existing `LIMIT` in the user's query and
  cannot detect truncation. Correct pattern: wrap the original SQL in a subquery
  and fetch `cap + 1`:
  ```ts
  const wrapped = `SELECT * FROM (${q.sql}) AS _q LIMIT ${cap + 1}`;
  const truncated = rawRows.length > cap;
  const rows = truncated ? rawRows.slice(0, cap) : rawRows;
  ```
  First seen: T4.2.

- **Nullable-column type inferred from first row.** If row 0 has `null` for a
  column, `typeof null === 'object'` → the inferred type defaults to `"string"`,
  hiding the true column type. Use a forward-scan helper (`firstNonNullValue(rows,
  col)`) to find the first non-null sample before calling the type inferrer.
  First seen: T4.2.

- **Vault env bleed between test suites.** Tests that invoke `encryptCredential` /
  `decryptCredential` must set `process.env.VAULT_MASTER_KEY` in `beforeEach` and
  delete it in `afterEach`. Omitting the teardown causes later test suites to pick
  up a stale key — or to crash because vault validates the key format on first call.
  First seen: T4.1 / T4.2.

## Ask pipeline (orchestrator)

- **Treating `block` as a terminal SSE event.** `block` is informational — the
  pipeline still sends `done` after it. Only `done` and `error` are terminal.
  UI must not close the SSE connection on `block`; the stream ends with `done`.
  First seen: T5.5.

- **Asserting fire-and-forget calls without flushing microtasks.** `addMessage`
  (assistant) and `emitAuditEvent` are fired without `await` in the finally block.
  Test assertions on them will silently miss unless you flush the microtask queue
  after `runAskPipeline` resolves:
  ```ts
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(mockEmitAuditEvent).toHaveBeenCalledWith(...);
  ```
  First seen: T5.5 (audit, block, validation-fail test groups).

- **Using DML to test validator rejection — gets gate-blocked instead.** When
  `node-sql-parser` processes DML (`DELETE`/`INSERT`/`UPDATE`) inside `evaluateGate`,
  it may throw on `tableList`/`columnList` access. The gate catches this, fails
  closed, and emits a `block` event — the pipeline never reaches the validator.
  To test validator-specific rejection (e.g. length limit), use a valid SELECT
  padded with a comment so the AST parses cleanly but the raw-string length check
  triggers:
  ```ts
  // Gate parses "SELECT x FROM t" (comment stripped → ≤ 35 chars, OK).
  // Validator checks sql.length on the raw string (35 + 7966 = 8001 > 8000 → VALIDATION).
  const q = `SELECT x FROM t -- ${"A".repeat(7966)}`;
  ```
  First seen: T5.5 integration tests.

## Prisma / DB access (control plane vs data plane)
- **Using Prisma for data-plane queries.** Prisma is **control plane only**
  (tenants/roles/users/grants/conversations/audit). Running a generated tenant query
  through Prisma executes on Prisma's pooled control-plane connection and **bypasses
  the restricted per-(tenant,role) credential**, defeating the L2 backstop. The
  Query Proxy must use raw drivers (`pg`/`mysql2`/`@google-cloud/bigquery`/`undici`)
  under the decrypted least-privilege credential — never Prisma.
- **`search_path` leakage between pooled connections.** Setting it with bare `SET
  search_path ...` on a Prisma connection persists for the connection's lifetime and
  leaks to the **next** request that borrows it from the pool — a cross-tenant
  isolation breach. Always use `SET LOCAL search_path ...` **inside a Prisma
  interactive transaction** so Postgres resets it at commit/rollback.
- **Connection-pool exhaustion from per-tenant PrismaClients.** Do **not** create a
  PrismaClient per tenant; each has its own pool and many tenants will exhaust
  Postgres `max_connections`. Use a **single** PrismaClient (one pool) with
  per-request `SET LOCAL search_path` for tenant scoping.
- **Unvalidated tenant id in `SET LOCAL`.** The schema name is interpolated into raw
  SQL; even though `tenantId` is the token-resolved id, quote it and assert it
  matches `tenant_[a-z0-9]+` before interpolation (no user-controlled input here, but
  fail closed).
- **Mixing the data-plane pool budget with Prisma's.** The Query Proxy keeps its own
  pools keyed by credential, sized independently of Prisma's `connection_limit`.
