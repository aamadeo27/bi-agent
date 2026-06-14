# Testing conventions

Every Task includes tests as part of its acceptance criteria. This doc is the
concrete reference Tasks point to via `kb-refs: conventions: [testing]`.

## Tools

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | **Vitest** | Pure functions, modules, React components (RTL). |
| API integration | **Vitest + Supertest** | Route → middleware → module → DB (test schema). |
| E2E | **Playwright** | Critical flows in a real browser against a running stack. |
| Accessibility | **axe-core** (via `@axe-core/playwright`) | WCAG 2.1 AA checks on each screen. |
| DB | **Testcontainers (Postgres)** or a disposable test schema | Real Postgres for tenant/gate/grant tests. |

## What every Task must do

- New logic → unit tests for happy path **and** failure/edge cases.
- New/changed API route → at least one integration test (auth + tenant scope + the
  route's own behavior).
- New screen/component → RTL render test + an axe accessibility assertion.
- Security-critical modules (permission gate, query validator, tenant scoping,
  restricted-credential proxy) → tests are **mandatory and adversarial** (see below).

## Security-critical test requirements (non-negotiable)

- **Permission gate:** for each grant shape, assert allow on fully-granted queries
  and **block** when any referenced schema/table/column is not granted; assert the
  `missing[]` payload is exact; assert it **fails closed** on unresolvable columns;
  assert it never returns a partial/subsetted result.
- **Tenant scoping:** assert a request scoped to tenant A cannot read/affect tenant
  B's rows even when the body supplies tenant B's ids.
- **Query validator:** assert rejection of multi-statement, DDL/DML, comment-hidden
  statements, and non-SELECT verbs.
- **Restricted credential:** assert the proxy uses the `(tenant,role,source)`
  credential and that a query exceeding the credential's grants is rejected at the
  source layer (integration test with a least-privilege DB role).
- **Auth:** expired/refresh token behavior; that a role change is reflected after
  refresh (GAP-17).

## Structure & conventions

- Co-locate unit tests next to source (`x.ts` + `x.test.ts`); E2E in `apps/web/e2e/`.
- Use the shared `packages/contracts` schemas to build fixtures so tests track the
  contract.
- Deterministic: **mock the `LlmProvider` port** in pipeline tests (never call
  Gemini in CI). One contract-test verifies the Gemini adapter shape against a
  recorded fixture.
- No network to real data sources in unit/integration; use Testcontainers or a
  local seeded source.
- CI runs: lint → typecheck → unit → integration → E2E(+axe). A PR is green only
  if all pass.

## Coverage expectation

- Security-critical modules: aim for full branch coverage of allow/deny paths.
- Other modules: cover the behaviors in the Task's acceptance criteria; no blanket
  percentage gate, but no untested new branch in a security-critical module.
