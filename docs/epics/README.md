# Epics — BI Result Presenter

Index of all epics. Security/RBAC foundation and tenant scaffolding come before
feature work. The Epic-execution orchestrator parses each epic's `deps:` line and
refuses to run an epic until its listed deps are `done` here.

| id | title | goal (one line) | status | deps | order |
|----|-------|-----------------|--------|------|-------|
| 001 | Foundation & scaffolding | Monorepo, shared contracts, Postgres + schema-per-tenant migrations, CI. | done | — | 1 |
| 002 | Auth & tenant isolation | email+password + per-tenant OIDC, invites, tenant-scope middleware, short-lived tokens. | done | 001 | 2 |
| 003 | RBAC & admin | Roles, schema/table/column grants, users, capability flags; admin API + UI. | done | 001, 002 | 3 |
| 004 | Data sources & restricted-credential proxy | Source registry, connectors (pg/mysql/bq/rest), cred vault, query proxy (L2). | planned | 001, 002, 003 | 4 |
| 005 | Ask pipeline (agent + gate) | LLM provider abstraction, orchestration, permission gate (L1), validator, chart selection, SSE streaming, conversations. | planned | 001, 002, 003, 004 | 5 |
| 006 | Chat workspace UI | Chat SPA, streaming render, charts, chart↔table toggle, export, query inspect, block/clarification states. | planned | 001, 002, 005 | 6 |
| 007 | Audit & observability | Persisted audit log + admin audit UI; OTel/pino monitoring hooks. | planned | 001, 002, 003, 005 | 7 |
| 008 | Infrastructure & operations | Tenant-provisioning script, IaC stub (Cloud Run/Cloud SQL/Secret Manager/KMS), per-tenant migration guide + lint. | **deferred (post-v1)** | 001, 002 | — |

## Notes
- 003 and 004 both depend on 002; 004 also depends on 003 (grants drive credential
  scope). 006 (frontend chat) can start its shell early but its data integration
  needs 005.
- Frontend admin screens in 003 can progress in parallel with backend RBAC once the
  contracts package (001) lands.
- **008 (infra-ops) is DEFERRED post-v1** (user scope decision). v1 deploys manually per
  `docs/DEPLOYMENT.md`; tenant onboarding/seed for v1 uses the inline seed in T1.7.
  Epic 008 codifies this (IaC + provision-tenant.ts + migration lint) as a fast-follow.
- Epic 001 gained T1.6 (Dockerfiles) and T1.7 (docker-compose); ci.yml + Turborepo cache
  remain owned by T1.5 (no separate task).
- Epic 007 v1 scope = T7.1–T7.3 + **only T7.4's P1 gate-bypass alert (A1)**; the full alert
  set (A2–A12) and **T7.5 dashboard provisioning are deferred post-v1** (user decision),
  with `kb/monitoring.md` as their manual runbook.
- All `T*.md` task ids referenced in each epic's wave plan have matching files.
