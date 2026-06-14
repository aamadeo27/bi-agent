---
generated: 2026-06-14T20:05:00Z
generator: devteam/status-updater@v1
commit: bootstrap
task: none
phase: design
overall_pct: 0
health: green
---

# Project Status

## Snapshot
- Phase: design (2/5) — pre-project planning complete; implementation not started
- Overall: 0%
- Health: green

## Features
| ID  | Feature | Status | Tests | Notes |
|-----|---------|--------|-------|-------|
| F1  | Foundation & scaffolding (epic 001) | todo | 0% | pnpm/Turborepo monorepo, contracts pkg, Postgres+Prisma (control plane), Dockerfiles, docker-compose, CI |
| F2  | Auth & tenant isolation (epic 002) | todo | 0% | email+password + per-tenant OIDC, admin-invite provisioning, tenant-scope middleware, short-lived JWT |
| F3  | RBAC & admin (epic 003) | todo | 0% | custom roles, schema/table/column grants, per-role capability flags (query-inspect), admin UI (S4–S6) |
| F4  | Data sources & restricted-credential proxy (epic 004) | todo | 0% | pg/mysql/bq/rest connectors, KMS credential vault, Query Proxy L2 (raw drivers, least-privilege) |
| F5  | Ask pipeline (agent + gate) (epic 005) | todo | 0% | Gemini provider abstraction, permission gate L1, query validator, chart-type selection, SSE, history + 365d purge |
| F6  | Chat workspace UI (epic 006) | todo | 0% | streaming render, charts (bar/line/pie/table), chart↔table toggle, export, query-inspect drawer, block/clarification states |
| F7  | Audit & observability (epic 007) | todo | 0% | persisted audit log + admin UI (S8), OTel/pino, P1 gate-bypass alert (A1 only) |

Status values: `todo | partial | done | blocked`.

> Deferred post-v1 (not counted in scope): epic 008 (infra-ops / IaC + automated tenant provisioning — manual via `docs/DEPLOYMENT.md`); observability alerts A2–A12 + dashboards (T7.5).

## Architecture
- [ ] Web SPA (React 18 + Vite, Recharts, Tailwind + Radix)
- [ ] API service (Express + Zod request validation)
- [ ] Control-plane DB (PostgreSQL 16, schema-per-tenant, Prisma; control plane only)
- [ ] Auth (email+password argon2id + per-tenant OIDC; short-lived JWT + rotating refresh)
- [ ] RBAC permission model (schema/table/column grants; per-role capability flags)
- [ ] Permission gate L1 (AST-based, pre-execution; block + explain)
- [ ] Query Proxy + restricted credential L2 (raw drivers pg/mysql2/bq/undici, least-privilege per tenant+role)
- [ ] Credential vault (KMS envelope encryption, AES-256-GCM)
- [ ] LLM provider abstraction + Gemini adapter (swappable)
- [ ] Query validator / injection guard
- [ ] Auto chart-type selection
- [ ] SSE streaming pipeline
- [ ] Conversations + history (365-day purge job)
- [ ] Data-source connectors (PostgreSQL, MySQL, BigQuery, generic REST)
- [ ] Audit log (persisted; CSV export)
- [ ] Observability (OpenTelemetry + pino; P1 gate-bypass alert A1)

## Dimensions
- Requirements coverage: 0% (spec documented 100%; implementation not started)
- Test coverage: 0%
- CI health: unknown (pipeline not yet built — T1.5)
- Doc freshness: ok (spec generated 2026-06-14)
- Velocity: n/a

## Risks
- Security critical path: the L1 permission gate + L2 restricted-credential proxy are the load-bearing defense-in-depth. Adversarial tests are mandatory; the P1 gate-bypass alert (A1) must never be suppressed.
- Prisma must remain control-plane only; tenant-data execution must never go through Prisma (would bypass L2). Enforced by lint/assertion + common-pitfalls.
- Epic 008 deferred: v1 deploy + tenant onboarding are manual (`docs/DEPLOYMENT.md`); first deploy has no automation safety net.

<!-- manual:start -->
## Next
- Run `/sequence bootstrap` to scaffold epic 001 (foundation), then `/sequence epic-execution 001`.

## Notes
- (operator-maintained)
<!-- manual:end -->
