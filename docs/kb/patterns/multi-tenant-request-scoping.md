## multi-tenant-request-scoping

- Tenant + role come **only** from the validated token, never request body/query.
- One middleware resolves `{tenantId, roleId, userId}` and pins the control-plane DB
  `search_path` to `tenant_<id>` for the request.
- **Prisma `search_path` pinning (control plane):** run the request's control-plane
  work inside a Prisma interactive transaction and set the path with `SET LOCAL`:

  ```ts
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "tenant_${tenantId}", platform`);
    // ...all control-plane queries for this request run here...
  });
  ```

  Use `SET LOCAL` (transaction-scoped), **never** bare `SET` — bare `SET` persists
  on the pooled connection and leaks to the next borrower (see common-pitfalls).
  Validate/whitelist `tenantId` (it is the resolved id, but still quote it) before
  interpolation; it must match `tenant_[a-z0-9]+`.
- **Data plane is separate:** any handler that needs the data plane passes
  `tenantId/roleId/dataSourceId` to the Query Proxy, which opens a **raw-driver**
  connection under the restricted credential. Prisma is never on the data path.
- Reject requests whose body references another tenant's ids (defense-in-depth).
