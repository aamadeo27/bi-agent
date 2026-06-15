# Bootstrap Plan — BI Result Presenter

> **Audience: coder (scaffold pass).** This is a concrete build spec, not prose.
> It derives from `devops.md`, `tech-stack.md`, and `conventions/README.md`.
> Conflicts vs. the source documents are flagged at the bottom.

---

## 1. Exact Monorepo Layout

```
bi-agent/                              ← repo root
├── .github/
│   └── workflows/
│       └── ci.yml                    ← GitHub Actions CI (T1.5)
├── apps/
│   ├── api/                          ← Express + TypeScript API (modular monolith)
│   │   ├── src/
│   │   │   ├── auth/                 ← identity, sessions, SSO, invites
│   │   │   ├── rbac/                 ← roles, grants, users, capability flags
│   │   │   ├── admin/               ← admin route handlers
│   │   │   ├── ask/                  ← ask pipeline: gate, validator, orchestrator
│   │   │   ├── llm/
│   │   │   │   ├── port.ts           ← LlmProvider interface
│   │   │   │   ├── adapters/
│   │   │   │   │   └── gemini.ts     ← @google/genai import lives HERE ONLY
│   │   │   │   └── factory.ts
│   │   │   ├── datasource/           ← connectors (pg/mysql2/bigquery/undici) + query proxy + vault
│   │   │   ├── conversations/        ← history + retention purge job
│   │   │   ├── audit/                ← audit log writer
│   │   │   ├── tenant/               ← tenant-scope middleware + withTenant helper
│   │   │   └── db/                   ← Prisma schema + migrations (control plane only)
│   │   │       ├── schema.prisma
│   │   │       └── migrations/
│   │   ├── Dockerfile                ← multi-stage Node 20 alpine (T1.6)
│   │   ├── .dockerignore
│   │   ├── package.json              ← deps: express, prisma client, zod, pino, argon2,
│   │   │                                       openid-client, node-sql-parser,
│   │   │                                       pg, mysql2, @google-cloud/bigquery, undici,
│   │   │                                       @google/genai, jsonwebtoken, @opentelemetry/*
│   │   └── tsconfig.json             ← extends ../../tsconfig.base.json
│   └── web/                          ← React 18 + Vite SPA
│       ├── src/
│       │   ├── features/             ← chat/, admin-roles/, admin-perms/, admin-users/,
│       │   │                                admin-datasources/, admin-audit/, auth/, account/
│       │   ├── components/           ← ChartCard, MessageBubble, shared UI
│       │   ├── charts/               ← Recharts wrappers + a11y
│       │   └── lib/
│       │       ├── api-client.ts     ← typed HTTP client consuming @bi/contracts types
│       │       └── sse-client.ts     ← SSE client consuming @bi/contracts event types
│       ├── Dockerfile                ← Vite build → nginx:alpine serve stage (T1.6)
│       ├── .dockerignore
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── package.json              ← deps: react, react-dom, react-router-dom,
│       │                                       @tanstack/react-query, @radix-ui/*,
│       │                                       recharts, @bi/contracts
│       │                              devDeps: @axe-core/react, @testing-library/*,
│       │                                       playwright, vite, tailwindcss, autoprefixer
│       └── tsconfig.json             ← extends ../../tsconfig.base.json
├── packages/
│   └── contracts/                    ← shared Zod schemas + inferred TS types (T1.3)
│       ├── src/
│       │   ├── chat.ts               ← SSE event shapes, ResultEnvelope
│       │   ├── rbac.ts               ← Role, ResourceGrant, User, DataSource
│       │   ├── audit.ts              ← AuditEvent
│       │   ├── auth.ts               ← auth payloads, JWT claims
│       │   ├── permission-block.ts   ← PermissionBlock
│       │   ├── generated-query.ts    ← GeneratedQueryView
│       │   └── error-codes.ts        ← error-codes discriminated union
│       ├── index.ts                  ← re-exports all schemas + types
│       ├── package.json              ← name: "@bi/contracts"; deps: zod only
│       └── tsconfig.json             ← extends ../../tsconfig.base.json
├── scripts/
│   └── provision-tenant.ts           ← tenant provisioning script (deferred: T8.1)
├── docker-compose.yml                ← local dev stack (T1.7)
├── package.json                      ← root; pnpm workspaces; root scripts
├── pnpm-workspace.yaml               ← workspaces: ["apps/*", "packages/*"]
├── turbo.json                        ← task graph (see §3)
├── tsconfig.base.json                ← strict: true, no any, path aliases
├── eslint.config.js                  ← flat config; custom rule: no provider SDK outside adapters/
├── .prettierrc
├── .gitignore                        ← node_modules, .env*, *.pem, *.key, dist/, .turbo/
├── .env.example                      ← placeholder values for all required vars (see §2)
└── README.md                         ← local-dev quick-start
```

### Package purposes and key dependencies (names only)

| Package | Purpose | Key deps |
|---------|---------|----------|
| `apps/api` | Express HTTP + SSE server; control-plane DB via Prisma; data-plane via raw drivers; LLM orchestration; auth; RBAC | `express`, `@prisma/client`, `prisma`, `zod`, `pino`, `argon2`, `openid-client`, `node-sql-parser`, `pg`, `mysql2`, `@google-cloud/bigquery`, `undici`, `@google/genai`, `jsonwebtoken`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` |
| `apps/web` | React 18 SPA; 11 screens; Tailwind + Radix UI; Recharts charts; SSE-driven chat | `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `@radix-ui/react-*`, `recharts`, `@bi/contracts` |
| `packages/contracts` | Single source of truth for FE/BE seam: Zod schemas + inferred TS types | `zod` |

---

## 2. Local Dev Environment

### One-command sequence

```sh
# 1. Install all workspace dependencies
pnpm install

# 2. Copy env template and fill in local values
cp .env.example .env.local
# Edit .env.local — at minimum set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
# KMS_KEY_REF (test stub), GEMINI_API_KEY

# 3. Start Postgres + API + run migrations/seed
docker compose up

# 4. In a second terminal — start the Vite dev server (fast HMR)
pnpm --filter web dev
```

SPA dev server talks to the API at `http://localhost:3000` (configured via `VITE_API_URL` in `.env.local` — this is not a secret, it is a URL only).

### docker-compose.yml services (T1.7)

| Service | Image | Role | Notes |
|---------|-------|------|-------|
| `db` | `postgres:16-alpine` | Control-plane Postgres | Named volume; port 5432 exposed on `127.0.0.1` only; healthcheck via `pg_isready` |
| `api` | Built from `apps/api/Dockerfile` | Express API | `depends_on: db (healthy)`; reads `.env.local` via `env_file`; port 3000 |
| `migrate-seed` | Built from `apps/api/Dockerfile` | One-shot | Runs after `db` healthy: `prisma migrate deploy` against `platform` schema, then provisions `tenant_demo` with seeded admin role (`can_inspect_query: ON`); exits 0 |

Web SPA is NOT in the default compose path. Optional `--profile full` may add it later (HMR is faster via host `pnpm dev`).

### .env.local variables required

All of these are already defined in `devops.md §6.1`; reproduced here for the coder. No new secrets invented.

| Variable | What it is | Example / stub value |
|----------|-----------|---------------------|
| `DATABASE_URL` | Prisma control-plane Postgres URL | `postgresql://postgres:postgres@localhost:5432/bi_platform` |
| `GEMINI_API_KEY` | Google Gemini API key | `your-gemini-api-key` |
| `JWT_ACCESS_SECRET` | JWT access token signing key | `dev-access-secret-change-me` |
| `JWT_REFRESH_SECRET` | JWT refresh token signing key | `dev-refresh-secret-change-me` |
| `KMS_KEY_REF` | KMS key reference for cred vault | `local-test-key` (emulated in dev) |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | API listen port | `3000` |
| `LOG_LEVEL` | Pino log level | `debug` |
| `LLM_PROVIDER` | LLM provider name | `gemini` |
| `LLM_MODEL` | LLM model identifier | `gemini-1.5-flash` |
| `RESULT_ROW_CAP` | Hard cap on result rows returned | `10000` |
| `CHART_DOWNGRADE_ROW_THRESHOLD` | Row count at which chart degrades to table | `2000` |
| `HISTORY_RETENTION_DAYS` | Conversation history retention | `365` |
| `VITE_API_URL` | SPA → API base URL (non-secret) | `http://localhost:3000` |

`TURBO_TOKEN` / `TURBO_TEAM` are GitHub Actions secrets only; not needed locally.

`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` are per-tenant, stored in the cred vault (encrypted in DB); they are not global `.env.local` vars.

`.env.example` commits all of the above with placeholder values. `.gitignore` blocks `.env`, `.env.local`, `*.pem`, `*.key`.

### Local logging / error sink (dev-only)

Pino logs stream to stdout in pretty-print mode (`pino-pretty` devDep). No cloud logging in dev. OpenTelemetry exporter points to `http://localhost:4317` (OTEL_EXPORTER_OTLP_ENDPOINT in `.env.example`); a local Jaeger or OTEL collector container can be added optionally via `--profile observability` in docker-compose. This is dev-only — no cloud infra in bootstrap.

---

## 3. CI Skeleton → Real (Stub-First Approach)

T1.5 owns the full CI pipeline. The scaffold order matters:

**Step 2 (T1.1 wave):** commit a passing `echo`-stub `.github/workflows/ci.yml` so the repo has a CI file and branch protection can be wired. Each job simply `echo`s its name and exits 0. This lets the DevTeam harness validate the task gate without real tests.

**Step 4 (T1.5 wave):** replace the stubs with the real `turbo`-driven pipeline per `devops.md §2`.

### Turborepo task graph — `turbo.json`

All tasks must be defined here with their `dependsOn` shape before the real CI is wired.

| Turbo task name | `dependsOn` | Tool | CI job name |
|----------------|------------|------|-------------|
| `lint` | `[]` (no dep; runs in parallel with `typecheck`) | ESLint + Prettier | `CI / lint` |
| `typecheck` | `[]` | `tsc --noEmit` (strict) | `CI / typecheck` |
| `test:unit` | `["typecheck"]` | Vitest; coverage gate on security-critical modules | `CI / unit` |
| `test:integration` | `["typecheck"]` | Vitest + Supertest + Testcontainers Postgres; `prisma migrate deploy` in test container | `CI / integration` |
| `test:security` | `["typecheck"]` | Adversarial Vitest suites (permission gate, query validator, tenant middleware, restricted-credential proxy) | `CI / security-tests` |
| `build` | `["typecheck", "lint"]` | `tsup` (API) + `vite build` (web) + `docker build` (both images) | `CI / build` |

Notes:
- `test:unit` and `test:integration` can run in parallel (both depend only on `typecheck`).
- `test:security` can run in parallel with `test:unit` and `test:integration` (also depends only on `typecheck`).
- `build` depends on `typecheck` + `lint` (not on tests — tests and build are parallel after typecheck/lint).
- `test:e2e` (`turbo test:e2e`, Playwright + axe-core) is NOT a PR gate; it runs post-merge on push to `main` only (separate job in `ci.yml`, not in the PR required checks list).

### Required PR checks (branch protection on `main`)

Exact check names that must be green before merge:
```
CI / lint
CI / typecheck
CI / unit
CI / integration
CI / build
CI / security-tests
```

`CI / e2e` is post-merge only. Not a merge gate.

### Turborepo remote cache

`TURBO_TOKEN` + `TURBO_TEAM` injected as GitHub Actions encrypted secrets. Local dev runs without remote cache (no token needed). Cache keys include `pnpm-lock.yaml` hash.

---

## 4. Dev-Only Services

| Service | Where | Notes |
|---------|-------|-------|
| Postgres 16 | `docker-compose.yml` — `db` service | Named volume, local only, port 5432 on 127.0.0.1 |
| API (Express) | `docker-compose.yml` — `api` service | Reads `.env.local`; no cloud infra |
| Migrate/seed | `docker-compose.yml` — `migrate-seed` one-shot | Applies Prisma migrations + seeds demo tenant |
| Vite dev server (SPA) | Host process via `pnpm --filter web dev` | HMR; not in compose |
| Pino logs | stdout / `pino-pretty` | Dev only; no cloud sink |
| OTEL collector (optional) | docker-compose `--profile observability` (not in default) | Jaeger or local collector; `localhost:4317` |

No cloud infra (Cloud Run, Cloud SQL, KMS, Secret Manager, Firebase Hosting, Artifact Registry) is provisioned in bootstrap. Epic 008 (infra-ops) is DEFERRED post-v1. v1 deploys follow `docs/DEPLOYMENT.md` (manual).

---

## 5. Scaffold Order (aligned to Epic 001 wave plan)

The coder must follow this sequence so each step has what it needs:

### Wave 1 — Foundation (parallel)
- **T1.1** — Monorepo scaffold: `pnpm-workspace.yaml`, root `package.json`, `turbo.json` (stub tasks), `tsconfig.base.json`, `eslint.config.js` (with custom provider SDK lint rule), `.prettierrc`, `.gitignore`, `.env.example`. Create `apps/api`, `apps/web`, `packages/contracts` as empty TS packages. `pnpm install && pnpm build` must pass.
- **T1.3** — Shared contracts package: implement all Zod schemas + types in `packages/contracts`. No dep on T1.2 or T1.4. Can run in parallel with T1.1 if T1.1 scaffold is committed first (since T1.3 has no `deps` listed, but it needs the package to exist).

  Practical order: T1.1 creates the empty `packages/contracts` shell → T1.3 fills it.

### Wave 2 — Backend + Frontend shells (parallel after T1.1)
- **T1.2** — Control-plane DB: Prisma schema + migrations, `withTenant` helper, Testcontainers integration test. Depends on T1.1.
- **T1.4** — Web app shell: React Router (11 placeholder screens), Tailwind + design tokens, Radix primitives, `apiClient` + `sseClient` in `lib/`, TanStack Query provider, axe smoke test. Depends on T1.1.

### Wave 3 — Infra (parallel after T1.1)
- **T1.6** — Dockerfiles: `apps/api/Dockerfile` (multi-stage Node 20 alpine) + `apps/web/Dockerfile` (Vite build → nginx:alpine). Depends on T1.1 only; can run in parallel with T1.2 and T1.4.

### Wave 4 — Compose + CI (after T1.2 + T1.6)
- **T1.7** — `docker-compose.yml`: `db` + `api` + `migrate-seed`. Depends on T1.1, T1.2, T1.6 (reuses API Dockerfile; migrate-seed calls the provisioning routine from T1.2).
- **T1.5** — Real CI pipeline: `.github/workflows/ci.yml` with all stages wired. Depends on T1.1, T1.2, T1.3, T1.4. At this point all packages and tests exist.

```
T1.1 (monorepo scaffold)
  ├── T1.3 (contracts — fill the shell)          ← parallel with T1.2/T1.4/T1.6
  ├── T1.2 (control-plane DB)                    ← parallel with T1.3/T1.4/T1.6
  ├── T1.4 (web shell)                           ← parallel with T1.2/T1.3/T1.6
  └── T1.6 (Dockerfiles)                         ← parallel with T1.2/T1.3/T1.4
        └── T1.7 (docker-compose)                ← needs T1.2 + T1.6
              └── T1.5 (CI pipeline)             ← needs T1.1+T1.2+T1.3+T1.4 (T1.7 helpful but not a declared dep)
```

---

## 6. Flagged Conflicts

| # | Conflict | Source A | Source B | Resolution |
|---|----------|---------|---------|-----------|
| C1 | **CI stub step** — the task files do not explicitly mention a passing echo-stub CI commit before the real pipeline. T1.5 acceptance criteria go straight to the real pipeline. | devops.md (implicit stub-first) | T1.5.md (real CI ACs only) | The stub is an internal scaffold technique, not an AC. T1.5 delivers the real pipeline. The coder may emit the stub as an intermediate commit within the T1.5 branch. No task change needed. |
| C2 | **T1.3 has no `deps` field** — but it needs the monorepo scaffold (empty `packages/contracts`) to exist before it can be filled. | T1.3.md (no deps listed) | T1.1.md (creates the package shells) | Not a real conflict — T1.3 being dep-free means it can start as soon as the package shell exists in wave 1. Coder must run T1.1 first regardless. |
| C3 | **T1.7 `migrate-seed` calls T8.1's `provision-tenant.ts`** — but T8.1 is DEFERRED post-v1. T1.7 notes allow "a thin inline seed" as an interim. | T1.7.md (notes: thin inline seed acceptable) | T8.1 (deferred) | Confirmed by T1.7 notes. Coder writes an inline seed in `migrate-seed`; it is replaced when T8.1 lands. No action needed now. |
| C4 | **KMS in dev** — devops.md §5.1 says "Emulated (local test key)" for dev. No KMS emulator image is specified. | devops.md (KMS emulated) | T1.7.md (no KMS service in compose) | `KMS_KEY_REF=local-test-key` is a stub string; the vault module must branch on `NODE_ENV=development` to use a local no-op key. No cloud KMS container needed in bootstrap. Coder must implement the dev stub in the vault module (part of T1.2 or a follow-on datasource task). |
| C5 | **`test:e2e` turbo task** — devops.md lists `test:e2e` as a turbo task, but T1.5 acceptance criteria do not list it in `turbo.json`. T1.5 notes say E2E runs post-merge only. | devops.md §2.1 (turbo task list includes test:e2e) | T1.5.md (ACs list only 6 tasks; notes say E2E is separate job not a PR gate) | Define `test:e2e` in `turbo.json` (so it can run in the post-merge job) but do NOT add it to the PR required checks. T1.5 must add both the turbo task entry and the separate `on: push to main` job. Not a blocker — coder includes it. |

No critical blocker conflicts found. All five are resolved by the existing task notes or are implementation details for the coder.

---

## Bootstrap review fixes (iteration 1)

Applied 2026-06-15 by coder fix-pass (iteration 1). All 5 MED + 5 LOW findings from `docs/tasks/bootstrap-findings.md` were resolved: `@axe-core/react` added to `apps/web` devDependencies (SCOPE-M1); `test:e2e` turbo task now depends on `build` so `vite preview` has dist available (SCOPE-M2); Playwright reporter ternary fixed to `"html"` locally and `"list"` in CI (QUAL-M1); Vite dev proxy now strips the `/api` prefix via a `rewrite` rule so API routes (`/health`, `/auth/...`) resolve correctly (QUAL-M2); `tsconfig.base.json` annotated with a comment explaining the NodeNext default and the Bundler override pattern required by web/contracts packages (QUAL-M3); `export {}` added to `scripts/provision-tenant.ts` for strict-ESM compliance (SCOPE-L1); `logger.ts` REDACT_PATHS normalized to double-quote style per `.prettierrc` (`singleQuote: false`), with the `set-cookie` entry kept single-quoted because it contains embedded double quotes (QUAL-L1); `apps/api/Dockerfile` runtime stage now copies `package.json` from the pnpm deploy output to support exports-map resolution (QUAL-L3); `eslint.config.js` custom rule updated from deprecated `context.getFilename()` to `context.filename` (QUAL-L4); `health.test.ts` converted to a true unit test (route registration inspection without Supertest) clearly distinguished from `health.integration.test.ts` which tests the full HTTP handler chain (QUAL-L2). All checks (`pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w test:unit`, `pnpm -w test:integration`, `pnpm -w test:security`, `pnpm -w build`) exit 0.
