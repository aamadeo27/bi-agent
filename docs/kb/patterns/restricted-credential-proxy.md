## restricted-credential-proxy

All data-source execution goes through the Query Proxy; nothing else holds creds.

```ts
async function execute(args: {
  tenantId; roleId; dataSourceId;
  query: ValidatedQuery;
}): Promise<RawResult>;
```

- Resolve credential by `(tenantId, roleId, dataSourceId)` from the cred vault;
  decrypt in-memory; never log it.
- The credential is itself least-privilege at the source (per-role DB role / REST
  token + allow-list) — L2 backstop to the gate's L1.
- **Use raw drivers only** (`pg` / `mysql2` / `@google-cloud/bigquery` / `undici`)
  on a connection/pool keyed by the restricted credential. **Never use Prisma here**
  — Prisma runs on the control-plane connection and would bypass the restricted
  credential, defeating L2. The proxy owns its own pools, separate from Prisma's.
- Enforce statement timeout + row LIMIT cap; read-only verbs only.
