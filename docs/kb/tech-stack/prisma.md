# DB access/migrations (control plane only) — Prisma + Prisma Migrate

**Chosen:** Prisma + Prisma Migrate  
**Alternatives:** Drizzle, Knex, raw pg

Mature schema modeling + migrations + type-safe client for the **control plane** (tenants/roles/users/grants/conversations/audit). **Scope boundary:** Prisma is control-plane only; the data plane (tenant-source execution) never uses Prisma — see (12) and §"Prisma + the credential model".


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
