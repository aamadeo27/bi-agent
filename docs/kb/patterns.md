# Patterns — BI Result Presenter

Implementation patterns every Task should follow. Item anchors match `kb-refs`
(`patterns: [provider-abstraction, ...]`).

---

## provider-abstraction

The Ask pipeline depends on a **port**, never on a concrete LLM SDK.

```ts
// packages/contracts or apps/api/src/llm/port.ts
export interface LlmProvider {
  /** Stream natural-language tokens for the user-facing answer. */
  streamText(input: LlmRequest): AsyncIterable<string>;
  /** Produce a structured query proposal (deterministic to parse). */
  generateQuery(input: LlmRequest): Promise<QueryProposal>;
  readonly id: string;       // "gemini"
  readonly model: string;    // configured model id
}
```

- Adapters: `GeminiProvider implements LlmProvider` (default, imports `@google/genai`).
- A `createLlmProvider(config)` factory selects the adapter from `LLM_PROVIDER`.
- **Rule:** no file outside `src/llm/adapters/*` may import a provider SDK. Lint-enforced.
- `QueryProposal` includes the query text **and** the model's declared referenced
  resources, but the gate re-derives resources from the query itself (never trusts
  the model's self-report).

---

## permission-gate-middleware

The gate is a pure, testable function placed **between** generation and execution
in the Ask pipeline (step 4). It is the security boundary — see common-pitfalls.

```ts
function evaluateGate(args: {
  query: GeneratedQuery;           // SQL/REST proposal
  grants: ResourceGrantSet;        // role's schema/table/column grants
  dialect: Dialect;
}): GateResult; // { allow: true } | { allow: false; missing: ResourceRef[] }
```

- Extract referenced resources by **parsing the query AST** (`node-sql-parser`),
  not by regex and not from the LLM's self-report.
- Resolve unqualified columns against referenced tables; if a column cannot be
  resolved to a granted resource → treat as missing (fail closed).
- On any missing resource → `allow:false` with the full `missing[]` list →
  pipeline returns the **block+explain** payload (no execution). Never subset.
- The gate runs again on every follow-up (no cached authorization).

---

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

---

## query-validation-injection-guard

After the gate, before execution (step 5). Defends NFR-SEC-3.

- Allow-list verbs: `SELECT` only (SQL) / declared read endpoints (REST).
- Reject: multiple statements, comments hiding statements, DDL/DML, `;` chains,
  `INTO OUTFILE`/`COPY`, set-returning functions not allow-listed.
- Parameterize literals; cap returned rows; cap query length.
- For REST: validate path + query params against the connector's declared schema.

---

## streaming-sse

Express has **no SSE helper**, so the response is driven manually.

```ts
// in the route handler
res.status(200).set({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
});
res.flushHeaders();                          // send headers immediately
const send = (event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
req.on('close', () => abortController.abort()); // client disconnect → cancel upstream
// ... send('token', { delta }) ... ; send('done', { messageId }); res.end();
```

- Disable compression/proxy buffering on this route (`no-transform`); behind nginx
  set `X-Accel-Buffering: no`.
- Events: `meta` (messageId + queryType + chart header), `token` (text delta),
  `result` (envelope), `block` (permission block), `error`, `done`.
- Backpressure: respect the client read rate; if the consumer is slow, buffer with
  a bounded queue and abort the upstream LLM stream on disconnect (avoid leaks).
- Always send a terminal `done`/`error`; client clears the StreamingIndicator on
  first `token` or `block`.

---

## request-validation

Express does **no schema validation** by itself. Every route validates with a Zod
middleware sourced from `packages/contracts` (single source of truth).

```ts
const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const r = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!r.success) return next(new AppError('VALIDATION', r.error.flatten()));
    req.valid = r.data;        // typed, validated input
    next();
  };
```

- Validate `body`, `params`, and `query` against the contract Zod schema before the
  handler runs; handlers read `req.valid`, never raw `req.body`.
- A validation failure maps to the `VALIDATION` error code (error-handling pattern).
- This middleware is the Express replacement for Fastify's built-in JSON-schema
  validation — apply it on every non-trivial route, including the SSE message route.

---

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

---

## rbac-grant-model

- Permissions are **additive grants** of read access at schema / table / column.
- A table grant implies all its columns unless specific columns are individually
  un-granted (tri-state UI in S5 maps to an explicit column grant set).
- The effective grant set for a request = the user's single role's grants.
- Capability flags (e.g. `canInspectQuery`) are role-level booleans, separate from
  resource grants.

---

## error-handling

- Typed error taxonomy surfaced to the client as a discriminated union:
  `GATE_BLOCK` (with `missing[]`), `CLARIFICATION` (LLM needs info), `VALIDATION`,
  `DATA_SOURCE`, `LLM_ERROR`, `AUTH`, `TENANT`, `NOT_FOUND`, `INTERNAL`.
- Each maps to a specific UI state (UI/UX §11): block message, clarification
  message, generic error bubble, etc.
- Never leak credentials, raw stack traces, or another tenant's identifiers in
  error payloads.

---

## auth-flow

- **email+password:** argon2id verify → issue short-lived JWT access (~15m) +
  rotating refresh in an httpOnly, Secure, SameSite cookie.
- **per-tenant SSO/OIDC:** tenant config holds the IdP; `openid-client` runs the
  code flow; on callback map the OIDC subject → tenant user (provisioned by invite).
- **invites:** tenant-admin creates a user → signed, expiring invite token emailed
  → invitee sets password (or links SSO) on accept.
- Token carries `{userId, tenantId, roleId}`; short TTL realizes GAP-17 propagation.

---

## client-result-cache (GAP-13)

- The SPA caches each message's full result envelope (TanStack Query) keyed by
  message id. Chart↔table toggle and export read this cache — **no re-query**.
- Cap cached rows in memory at the row cap (GAP-8); above it, table view paginates
  from the cached set; export streams from cache. Toggle state is per-message.
