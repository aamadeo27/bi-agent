# Knowledge Base — BI Result Presenter

Canonical shared reference for all DevTeam agents. Read the relevant sub-doc(s)
listed in each Task's `kb-refs` plus this index. Keep entries to pointers.

## Index

- [system-design.md](system-design.md) — components, ask-question pipeline, permission gate, credential restriction, tenant isolation, Gemini provider abstraction, deployment topology.
- [tech-stack.md](tech-stack.md) — per-component stack table (Express + Prisma confirmed) + the Prisma-vs-credential-model reconciliation.
- [patterns.md](patterns.md) — provider abstraction, permission-gate middleware, restricted-credential proxy, query-validation guard, request-validation (Zod), streaming-sse (Express), tenant request scoping, error handling, auth flow.
- [contracts.md](contracts.md) — chat/query API, RBAC schema (schema/table/column), query-result envelope, audit event shape, shared types.
- [devops.md](devops.md) — CI/CD pipeline, environments (dev/staging/prod), build/deploy strategy, DB migration + per-tenant schema provisioning, rollback, infra, env config, monitoring hooks, new tasks flagged.
- [conventions/README.md](conventions/README.md) — naming, folder layout, conventions index.
- [conventions/testing.md](conventions/testing.md) — testing conventions (used by every Task).
- [conventions/branching.md](conventions/branching.md) — branch naming, PR flow, commit convention + Task footer, required CI checks.
- [conventions/secrets.md](conventions/secrets.md) — secrets store per env, required secrets list, local dev story, rotation policy, hard rules.
- [monitoring-direction.md](monitoring-direction.md) — what must be observable (gate, latency, LLM cost/tokens, errors). Direction only; `monitor` agent owns concrete config.
- [monitoring.md](monitoring.md) — concrete monitoring config: metrics catalog (names/types/labels/source spans), SLOs, alert rules (incl. P1 gate-bypass), dashboard panel groups. Produced from monitoring-direction.
- [common-pitfalls.md](common-pitfalls.md) — gate bypass, tenant leakage, LLM injection, streaming back-pressure, export leaks.

## Locked decisions (do not re-open)

- Permissions: schema/table/column only. Row-level OUT of scope.
- LLM: Google Gemini default, behind swappable provider abstraction (config-driven).
- Auth: email+password + optional per-tenant SSO/OIDC; tenant-admin email invite.
- Partial-permission queries: block + explain (no silent subsetting).
- Per-role "can inspect generated query" capability toggle.
- A11y: WCAG 2.1 AA.
- v1 charts: bar, line, pie/donut, table; chart↔table toggle only.

## Architect decisions (resolved gaps) — see system-design.md for detail

- GAP-4 history retention → **365-day default auto-purge (scheduled job) + manual user delete.**
- GAP-5 credential restriction → per-(tenant,role) credential mapping + query-proxy/policy layer (raw drivers, never Prisma).
- GAP-6 tenant isolation → schema-per-tenant in shared Postgres (control plane); Prisma pins `search_path` per-request via `SET LOCAL`.
- GAP-13 chart/table toggle → client-side cached result, no re-query.
- GAP-14 export → client-side for results under threshold; warns above 5k; server-streamed for large.
- GAP-16 v1 data sources → PostgreSQL, MySQL, BigQuery, generic REST.
- GAP-17 permission propagation → next session/token refresh (short-lived tokens).
- GAP-18 residual → schema-only to Gemini; no row data in prompts; PII guard.

## Confirmed (previously flagged) — see system-design.md §8

GAP-2 (no super-admin v1), GAP-4 (365-day purge + manual delete), GAP-8 (perf caps),
GAP-9 (persisted audit), GAP-20 (dashboards out), single-role-per-user,
GAP-1 (view-query default off). All user-confirmed; no longer pending sign-off.

> **Stack update (confirmed):** API framework = **Express** (was Fastify);
> DB access = **Prisma, control-plane only** (was Drizzle). Data-plane execution
> stays on raw least-privilege drivers — never Prisma. See tech-stack §"Prisma + the
> credential model".
