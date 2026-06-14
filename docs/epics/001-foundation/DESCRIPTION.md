# Epic 001 — Foundation & scaffolding

Stand up the monorepo, the shared contracts package, the control-plane Postgres
with schema-per-tenant migrations, and CI. Everything else builds on this.

## Motivation
Enables every later epic. Realizes the repo layout (conventions), the FE/BE
contract seam (contracts.md), the tenant isolation substrate (GAP-6,
schema-per-tenant), and the testing/CI baseline (testing.md).

## Definition of Done
- `pnpm` monorepo (`apps/web`, `apps/api`, `packages/contracts`) builds, lints,
  typechecks.
- `packages/contracts` exports the Zod schemas + types from contracts.md.
- Postgres runs locally; migrations create the `platform` schema (tenant registry)
  and a tenant-schema provisioning routine (`tenant_<id>`).
- CI pipeline runs lint → typecheck → unit → integration → build → security-tests on PRs.
- Both apps containerize (multi-stage Dockerfiles); `docker compose up` brings up a
  working local stack (DB + API + migrate/seed).

## Tasks
- T1.1 Monorepo scaffold (pnpm + Turborepo)
- T1.2 Control-plane DB + schema-per-tenant migrations (Prisma)
- T1.3 Shared contracts package (Zod)
- T1.4 Web app shell + tokens + SSE client
- T1.5 CI pipeline (lint/typecheck/unit/integration/build/security-tests; ci.yml + Turborepo cache)
- T1.6 Dockerfiles — API (multi-stage) and Web (Vite build)
- T1.7 docker-compose for local dev (API + Postgres + seed)

## Dependency graph & parallelism plan

Wave 1 (parallel): T1.1, T1.3
Wave 2 (parallel): T1.2, T1.4, T1.6
Wave 3 (parallel): T1.5, T1.7

- T1.1 monorepo scaffold; T1.3 contracts package can be authored in parallel (pure types).
- T1.2 (DB + migrations), T1.4 (web app shell), and T1.6 (Dockerfiles) depend on T1.1.
- T1.5 (CI) depends on the apps existing and contracts compiling; T1.5's `build` job
  consumes the Dockerfiles from T1.6.
- T1.7 (docker-compose) depends on T1.1, T1.2, T1.6.
- Note: ci.yml + Turborepo remote cache are owned by T1.5 — there is no separate task
  for them (an earlier devops pass flagged a duplicate ci.yml task; folded into T1.5).

## Risks / open questions
- Tenant-provisioning routine shape affects 002/003; keep it a callable service.
