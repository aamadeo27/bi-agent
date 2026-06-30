# Patterns — index

Implementation patterns every Task should follow. Item anchors match `kb-refs`
(`patterns: [provider-abstraction, ...]`).

---

- [provider-abstraction](provider-abstraction.md) — The Ask pipeline depends on a **port**, never on a concrete LLM SDK.
- [permission-gate-middleware](permission-gate-middleware.md) — The gate is a pure, testable function placed **between** generation and execution
- [restricted-credential-proxy](restricted-credential-proxy.md) — All data-source execution goes through the Query Proxy; nothing else holds creds.
- [query-validation-injection-guard](query-validation-injection-guard.md) — After the gate, before execution (step 5). Defends NFR-SEC-3.
- [streaming-sse](streaming-sse.md) — Express has **no SSE helper**, so the response is driven manually.
- [request-validation](request-validation.md) — Express does **no schema validation** by itself. Every route validates with a Zod
- [multi-tenant-request-scoping](multi-tenant-request-scoping.md) — - Tenant + role come **only** from the validated token, never request body/query.
- [rbac-grant-model](rbac-grant-model.md) — - Permissions are **additive grants** of read access at schema / table / column.
- [error-handling](error-handling.md) — - Typed error taxonomy surfaced to the client as a discriminated union:
- [auth-flow](auth-flow.md) — - **email+password:** argon2id verify → issue short-lived JWT access (~15m) +
- [client-result-cache](client-result-cache.md) — SPA caches each message's full result envelope (TanStack Query); toggle/export read cache, no re-query.

---

See also:
- [common-pitfalls § Data-source connectors](../common-pitfalls.md#data-source-connectors) — credential-leak, row-cap, nullable-type, vault-env (epic 004).
- [common-pitfalls § Ask pipeline (orchestrator)](../common-pitfalls.md#ask-pipeline-orchestrator) — block-is-non-terminal, fire-and-forget test flushing, DML gate-blocks vs validator rejection (epic 005).
