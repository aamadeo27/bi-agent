# DevOps Plan — BI Result Presenter

> **Status: v1 plan.** Recommendations are concrete; infra host is not locked until
> IaC is provisioned. Revisit CI host / deploy target at the start of the first
> sprint that needs a running environment.

---

## 1. Environments

### 1.1 Dev

| Attribute | Value |
|-----------|-------|
| Purpose | PR validation, local developer iteration |
| Trigger | Every PR branch push; merged to `main` |
| Scale | Minimal (single API container replica, shared Postgres instance) |
| Data | Seeded synthetic fixtures; no real tenant data |
| Access | Developers only; URL behind basic auth or VPN if hosted |
| Postgres | Shared dev database; per-deploy fresh migration run |
| Secrets | GitHub Actions encrypted secrets (prefixed `DEV_`) |

### 1.2 Staging

Staging is justified here because the app involves:
- KMS-encrypted credential vault operations that must be end-to-end tested against
  real managed KMS (not mocked).
- Multi-tenant schema provisioning that must be validated before prod migrations.
- Playwright + axe E2E tests that need a full running stack.

| Attribute | Value |
|-----------|-------|
| Purpose | Pre-production integration gate; E2E + security tests run here |
| Trigger | Merge to `main` after PR CI passes |
| Scale | Matches prod topology at minimum viable size (1 API replica, managed Postgres) |
| Data | Anonymized / synthetic; never real PII; seeded tenants for E2E |
| Access | QA + senior engineers; URL not publicly reachable |
| Postgres | Dedicated staging DB; full migration suite runs on each deploy |
| Secrets | GitHub Actions encrypted secrets (prefixed `STAGING_`) |

### 1.3 Prod

| Attribute | Value |
|-----------|-------|
| Purpose | Live multi-tenant SaaS |
| Trigger | Manual approval gate after staging deploy succeeds and all checks pass |
| Scale | Horizontal API replicas behind load balancer; managed Postgres; CDN for SPA |
| Data | Real tenant data; encrypted cred vault; 365-day audit retention |
| Access | End users via HTTPS; ops team via cloud console |
| Postgres | Managed Postgres (e.g. Cloud SQL, RDS, Supabase); automated backups |
| Secrets | Cloud secret manager (e.g. GCP Secret Manager, AWS Secrets Manager) |
| SLO | p95 end-to-end < 6 s (GAP-8); 99.5% uptime target |

---

## 2. CI Pipeline

**Recommended host: GitHub Actions.**
Rationale: monorepo is already on git; GitHub Actions has first-class Turborepo
caching support (official `actions/cache` + `turbo` remote cache config); no
additional service to maintain.

### 2.1 Pipeline stages (in order)

```
install → lint → typecheck → unit → integration → build → e2e → security-tests → deploy
```

| Stage | Turborepo task | Tool(s) | Gate |
|-------|---------------|---------|------|
| `install` | — | `pnpm install --frozen-lockfile` | Hard |
| `lint` | `turbo lint` | ESLint + Prettier check | Hard |
| `typecheck` | `turbo typecheck` | `tsc --noEmit` (strict) | Hard |
| `unit` | `turbo test:unit` | Vitest; adversarial tests for permission gate, query validator, tenant scoping, restricted-credential proxy | Hard |
| `integration` | `turbo test:integration` | Vitest + Supertest; Testcontainers Postgres for control-plane; tenant isolation (T1.2) | Hard |
| `build` | `turbo build` | `tsup` (API), `vite build` (web); multi-stage Docker image builds | Hard |
| `e2e` | `turbo test:e2e` | Playwright + axe-core; WCAG 2.1 AA assertions; runs against staging-like stack | Hard (post-merge only on staging) |
| `security-tests` | `turbo test:security` | Adversarial Vitest suites for security-critical modules (see §2.3) | Hard |
| `deploy` | — | Docker push + cloud run / ECS deploy; migration step (see §4) | Hard |

### 2.2 Turborepo caching

- Turborepo remote cache is enabled for all `turbo` tasks using the official
  `TURBO_TOKEN` + `TURBO_TEAM` env vars (set as GitHub Actions secrets).
- Local dev: developers run `turbo` with the same task graph; cache hits skip
  redundant work across workspace packages.
- Cache keys include `package.json` + `pnpm-lock.yaml` hashes; invalidated on
  lockfile change.

### 2.3 Adversarial / security-critical test requirements

The following modules have mandatory adversarial test suites that CI gates on:

| Module | Test concern |
|--------|-------------|
| Permission gate (`ask/gate`) | Attempt queries referencing tables/columns outside grants; confirm block + structured block payload |
| Query validator (`ask/validator`) | DDL, multi-statement, non-SELECT, injection patterns; confirm rejection |
| Tenant-scope middleware (`tenant/`) | Cross-tenant id injection in request body; confirm ignored |
| Restricted-credential proxy (`datasource/query-proxy`) | Confirm raw driver, not Prisma; credential scoped to `(tenantId, roleId, sourceId)` |

These live under `test:security` in the Turborepo task graph and run in a separate
job so failures are surfaced with a distinct label.

### 2.4 Trigger rules

| Event | Jobs run |
|-------|----------|
| PR branch push | `install → lint → typecheck → unit → integration → build → security-tests` |
| Merge to `main` | All of the above + `e2e` against staging + staging deploy |
| Manual / tag | Prod deploy (approval required) |

### 2.5 Required PR checks (branch protection)

All must be green before merge:
- `CI / lint`
- `CI / typecheck`
- `CI / unit`
- `CI / integration`
- `CI / build`
- `CI / security-tests`

E2E (`CI / e2e`) runs post-merge on staging; prod deploy blocked until it passes.

---

## 3. CD — Build and Deploy Strategy

**Recommended deploy target: Google Cloud Run (API) + Cloud CDN / Firebase Hosting
(SPA).**
Rationale: Cloud Run is stateless-container-native (matches the API), scales to
zero in dev/staging, native KMS/Secret Manager integration, managed TLS. SPA as
static files on CDN. Swap to AWS (ECS Fargate + CloudFront) or Fly.io with no
code changes — all infra references are in IaC, not app code.

### 3.1 API deploy

1. Multi-stage Docker build (`apps/api/Dockerfile`): `node:20-alpine` builder +
   minimal runtime image. Image tagged `:<git-sha>`.
2. Push image to container registry (e.g. Google Artifact Registry / ECR).
3. Run DB migrations (see §4) before the new image receives traffic.
4. Deploy new revision to Cloud Run (or ECS); old revision stays warm during
   rollout.
5. Smoke test: health-check endpoint (`GET /health`) returns 200.
6. Shift traffic to new revision (Cloud Run traffic split → 100%).

### 3.2 SPA deploy

1. `vite build` produces `dist/` static files.
2. Upload to CDN bucket / Firebase Hosting with cache-busted asset fingerprints.
3. `index.html` served with `Cache-Control: no-cache` so the latest shell is
   always fetched.

### 3.3 Rollback

- **API:** Cloud Run keeps prior revisions. On smoke-test failure or manual
  trigger, shift traffic back to the previous revision (`gcloud run services
  update-traffic --to-revisions=<prev>=100`). No re-deploy needed.
- **SPA:** CDN bucket retains previous deployment. Re-point CDN origin or restore
  from bucket versioning.
- **DB migrations:** migrations must be backward-compatible (additive only in v1).
  If a breaking migration is ever needed, use the expand-contract pattern: expand
  in one release, remove old column/table in a later release after all API replicas
  have updated.

---

## 4. DB Migration Strategy

### 4.1 Control-plane schema (Prisma Migrate)

- Migrations live at `apps/api/src/db/migrations/` (Prisma default).
- `prisma migrate deploy` is run as a one-shot step in the CI/CD deploy job,
  **before** the new API revision receives traffic.
- In CI (integration stage), `prisma migrate deploy` runs against the
  Testcontainers Postgres instance; this validates migrations on every PR.
- Only additive changes in v1 (new tables, new optional columns, new indexes).
  `prisma migrate diff` is part of the pre-merge review checklist.

### 4.2 Per-tenant schema provisioning

Each new tenant gets a dedicated Postgres schema (`tenant_<ulid>`). Provisioning
is a two-step operation run by the tenant-onboarding service/script:

1. **Create schema:** `CREATE SCHEMA IF NOT EXISTS "tenant_<ulid>"`.
2. **Apply template:** run a Prisma migration set scoped to the new schema by
   setting `search_path` before `prisma migrate deploy` (or a raw SQL seed script
   that replicates the control-plane tenant-schema DDL).

In v1 (GAP-2: no super-admin UI), tenant provisioning is triggered by an ops
script (`scripts/provision-tenant.ts`). The script:

- Inserts the tenant row into the platform schema.
- Creates `tenant_<ulid>` schema.
- Runs the tenant-schema DDL (roles, permissions, conversations, audit, data-source
  registry, cred-vault refs tables).
- Optionally seeds a default Admin role and invite link.

When new control-plane migrations add columns to tenant schemas, the migration file
must include a loop over all `tenant_*` schemas and apply the DDL to each. This
is enforced by a code-review checklist item (see conventions).

### 4.3 Audit log + history purge (GAP-4, GAP-9)

The conversation-history and audit-event purge job (T5.8) runs on
a schedule (daily cron). In production, schedule via Cloud Scheduler (or AWS
EventBridge) hitting a protected internal endpoint, or as a Kubernetes CronJob if
moved to GKE. The endpoint requires an internal service-account token, not exposed
to the internet.

---

## 5. Infrastructure

### 5.1 Hosting per component

| Component | Dev | Staging | Prod |
|-----------|-----|---------|------|
| API (Node/Express) | Docker Compose locally; or Cloud Run (free tier) | Cloud Run | Cloud Run (horizontal replicas, min-instances=1) |
| SPA (React+Vite) | `vite dev` locally | Firebase Hosting / CDN | Firebase Hosting / CDN with cache headers |
| Control-plane Postgres | Docker Compose locally | Cloud SQL (dev tier) | Cloud SQL (production tier, HA, automated backups) |
| KMS (envelope encryption) | Emulated (local test key) | GCP Cloud KMS (test keyring) | GCP Cloud KMS (production keyring, IAM-restricted) |
| Secret store | `.env.local` (gitignored) | GCP Secret Manager | GCP Secret Manager |
| Container registry | Local | Google Artifact Registry | Google Artifact Registry |
| CDN / static | Local file server | Firebase Hosting | Firebase Hosting / Cloud CDN |

### 5.2 Networking

- API exposed via HTTPS only (Cloud Run manages TLS); no HTTP.
- SPA served from CDN; `Content-Security-Policy` set to restrict origins.
- Control-plane Postgres: private VPC network only; API connects via private IP or
  Cloud SQL Auth Proxy (no public IP on the DB).
- Tenant data sources: the Query Proxy egresses from the API service; egress IPs
  are allowlisted in staging/prod for known tenant DB hosts.
- Internal cron / purge endpoint: not routed through the public load balancer
  (Cloud Run service-to-service auth with OIDC token, or internal ingress only).

### 5.3 Backups

- Postgres: automated daily snapshots (Cloud SQL default), point-in-time recovery
  enabled. Prod retention: 7 days minimum.
- Cred vault encryption keys: KMS keys are managed / backed up by GCP; key
  versions are retained per KMS policy (do not destroy active versions).
- SPA static assets: versioned in CDN bucket; no separate backup needed.

---

## 6. Env Config

### 6.1 Required secrets (all environments)

| Secret name | What it is | Dev source | Staging / Prod source |
|-------------|-----------|-----------|----------------------|
| `DATABASE_URL` | Prisma / control-plane Postgres connection string | `.env.local` | Secret Manager |
| `GEMINI_API_KEY` | Google Gemini API key (LLM default provider) | `.env.local` | Secret Manager |
| `JWT_ACCESS_SECRET` | Signing key for short-lived access tokens (~15 min) | `.env.local` | Secret Manager |
| `JWT_REFRESH_SECRET` | Signing key for rotating refresh tokens | `.env.local` | Secret Manager |
| `KMS_KEY_REF` | Cloud KMS key resource name for cred-vault master key | `.env.local` (test key) | Secret Manager |
| `OIDC_CLIENT_ID` | Per-tenant OIDC client id (per-tenant, loaded at runtime) | `.env.local` or DB | DB (encrypted in cred vault) |
| `OIDC_CLIENT_SECRET` | Per-tenant OIDC client secret | `.env.local` or DB | DB (encrypted in cred vault) |
| `TURBO_TOKEN` | Turborepo remote cache token | GitHub Actions secret | GitHub Actions secret |
| `TURBO_TEAM` | Turborepo remote cache team | GitHub Actions secret | GitHub Actions secret |

> Note: per-tenant `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` are not global env
> vars — they are stored encrypted in the control-plane DB (cred vault) and fetched
> at runtime per tenant. Only the KMS key reference (`KMS_KEY_REF`) is a global
> runtime secret.

### 6.2 Non-secret env vars (safe to commit in `.env.example`)

```
NODE_ENV=development|staging|production
PORT=3000
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-flash
LOG_LEVEL=info
RESULT_ROW_CAP=10000
CHART_DOWNGRADE_ROW_THRESHOLD=2000
HISTORY_RETENTION_DAYS=365
OTEL_SERVICE_NAME=bi-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

### 6.3 How secrets reach the app

| Environment | Mechanism |
|-------------|-----------|
| Local dev | `.env.local` file (gitignored); loaded by `dotenv` at startup |
| Staging / Prod (Cloud Run) | Mounted as env vars from GCP Secret Manager via Cloud Run secret references; injected at container start, not in the image |
| CI (GitHub Actions) | GitHub Actions encrypted secrets injected as env vars for the job |

**Hard rule:** no secret ever appears in:
- Source code or committed config files.
- Docker image layers (`ENV` statements or `COPY`-ed files containing values).
- Application logs (pino config must redact `password`, `token`, `secret`, `key`,
  `credential` fields — enforce in logging conventions).
- Client bundles (Vite build must have no `VITE_*` prefix on any secret).

---

## 7. Monitoring Hooks

Alignment with `monitoring-direction.md`:

| Signal | Instrumentation | Destination |
|--------|----------------|-------------|
| Structured logs | pino; `tenantId`, `userId`, `requestId` on every line | Cloud Logging (GCP) or CloudWatch |
| Traces | OpenTelemetry SDK auto + manual spans on gate, LLM, data-source exec | Cloud Trace / Jaeger |
| Metrics | OTel metrics: gate allow/block rate, p50/p95 query latency, LLM token usage, error rate by type | Cloud Monitoring / Prometheus |
| Health check | `GET /health` — DB ping + basic process check | Cloud Run health probe; uptime check |
| Alerts | Error rate spike, p95 > 6 s, LLM cost threshold, gate block rate anomaly | Cloud Monitoring alerting policy (configured by `monitor` agent) |

Concrete backend config and alert thresholds are the `monitor` agent's deliverable
(monitoring-direction.md §7).

---

## 8. DevOps Tasks (resolved)

The tasks this plan flagged have been materialized (or reconciled). Current state:

| Task id | Description | Epic / status |
|---------|-------------|---------------|
| `T1.6` | `apps/api/Dockerfile` (multi-stage, Node 20 alpine) + `apps/web/Dockerfile` (Vite build). `docker build` verified in CI. | 001-foundation · **created** |
| `T1.7` | `docker-compose.yml` for local dev: API + Postgres + migrate/seed. | 001-foundation · **created** |
| ci.yml | GitHub Actions workflow (install → lint → typecheck → unit → integration → build → security-tests) + Turborepo remote cache. | **owned by T1.5** (no separate task; a proposed duplicate ci.yml task was dropped) |
| `T8.1` | `scripts/provision-tenant.ts`: create `tenant_<id>` schema, apply DDL, seed Admin role. | 008-infra-ops · **created, DEFERRED post-v1** |
| `T8.2` | IaC stub (Terraform/Pulumi): Cloud Run + Cloud SQL + Secret Manager + KMS. | 008-infra-ops · **created, DEFERRED post-v1** |
| `T8.3` | Per-tenant migration authoring guide + CI lint check. | 008-infra-ops · **created, DEFERRED post-v1** |

> **Epic 008-infra-ops is DEFERRED to post-v1** (user scope decision). v1 deploys
> **manually** per `docs/DEPLOYMENT.md`; tenant onboarding/seed for v1 uses the inline
> seed in T1.7. Epic 008 codifies this as a fast-follow once deploy patterns stabilize.
