# Data-source connectors (data plane) — `pg`, `mysql2`, `@google-cloud/bigquery`, `undici` (REST)

**Chosen:** `pg`, `mysql2`, `@google-cloud/bigquery`, `undici` (REST)  
**Alternatives:** knex multi-dialect, ORMs/Prisma

Direct, minimal **raw drivers** per v1 source type (GAP-16); the Query Proxy owns the connection + the least-privilege per-(tenant,role) credential. **Prisma is never used here** — data-plane execution must run on the restricted credential, not Prisma's pooled control-plane connection.
