# Deployment & operations (v1 — manual)

> v1 deploys **manually** following this guide. Infrastructure automation (IaC,
> automated tenant provisioning) is **deferred to post-v1** (epic 008). When epic 008
> is later scheduled, the automated path replaces the manual steps here. This guide is
> the authoritative v1 ops runbook; keep it in sync with `docs/kb/devops.md`.

Target topology (per `docs/kb/devops.md`, all swappable): API on **Cloud Run**, SPA on
**Firebase Hosting / CDN**, control-plane DB on **Cloud SQL (Postgres 16)**, secrets in
**Secret Manager**, credential-vault key in **KMS**. CI = GitHub Actions.

## 1. Required secrets (set in Secret Manager / CI before deploy)

| Secret | Where | Purpose |
|--------|-------|---------|
| `DATABASE_URL` | Secret Manager | Control-plane Postgres connection |
| `GEMINI_API_KEY` | Secret Manager | Default LLM provider key (swappable) |
| `JWT_ACCESS_SECRET` | Secret Manager | Short-lived access token signing |
| `JWT_REFRESH_SECRET` | Secret Manager | Refresh token signing |
| `KMS_KEY_REF` | Secret Manager | Credential-vault envelope-encryption key |
| `TURBO_TOKEN` / `TURBO_TEAM` | GitHub Actions secrets | Turborepo remote cache |
| `GCP_SERVICE_ACCOUNT_KEY` | GitHub Actions secret (or Workload Identity) | Deploy auth |

No secret values are committed. Per-tenant OIDC credentials live in the encrypted
credential vault in the control-plane DB, not env vars.

## 2. Provision infrastructure (manual, one-time per environment)

1. Create a Cloud SQL Postgres 16 instance; create the application database.
2. Create a KMS keyring + key for the credential vault; record its ref as `KMS_KEY_REF`.
3. Create Secret Manager entries for every secret in §1.
4. Create the Cloud Run service (API) and Firebase Hosting site (SPA); grant the API
   service account read access to the relevant secrets.

(Each of these becomes a Terraform/Pulumi resource when epic T8.2 is scheduled.)

## 3. Build & deploy

1. CI (`T1.5`, `.github/workflows/ci.yml`) builds the API image
   (`apps/api/Dockerfile`) and the SPA static bundle on merge to `main`.
2. Push the API image; deploy it to Cloud Run with env wired from Secret Manager.
3. Deploy the SPA bundle to Firebase Hosting / CDN.
4. Run control-plane migrations against the database: `prisma migrate deploy`
   (control plane / `platform` schema).

## 4. Tenant onboarding (manual, v1)

Until `T8.1 provision-tenant.ts` is built, onboard a tenant by hand:

1. Insert the tenant row into the `platform` tenant registry.
2. Create the `tenant_<id>` Postgres schema.
3. Apply control-plane migrations scoped to that schema using `SET LOCAL search_path`
   (never bare `SET search_path` — it leaks across pooled connections; see
   `docs/kb/common-pitfalls.md`).
4. Seed one tenant admin role with the `can_inspect_query` capability **on** and full
   schema/table/column grant scope; create the admin user invite.

The local docker-compose stack (`T1.7`) performs steps 2–4 inline for a demo tenant,
so its seed script is the reference for the manual SQL/DDL.

## 5. Migrations (per-tenant safety)

Because every tenant has its own schema, a careless migration can break isolation.
Until the `T8.3` migration lint exists, manually verify each migration: no
hardcoded `tenant_*` schema names, no cross-schema references, `SET LOCAL` (not bare
`SET`) for search_path, and idempotent DDL applied across all tenant schemas.

## 6. Rollback

- API: redeploy the previous Cloud Run revision (image tagged by git SHA).
- DB: prefer forward-fix migrations; destructive changes require a backfill plan
  (see migration guidance above).

## 7. Observability (v1)

OTel + pino instrumentation (`T7.3`) ships in v1. The **P1 permission-gate
bypass/error alert (A1)** is provisioned as code (`T7.4`) and must never be
suppressed. The remaining alerts (A2–A12) and the dashboards (`T7.5`) are deferred
post-v1 — wire them manually from `docs/kb/monitoring.md` if needed before then.
Recommended fast-follow: alert A2 (cross-tenant access attempts).
