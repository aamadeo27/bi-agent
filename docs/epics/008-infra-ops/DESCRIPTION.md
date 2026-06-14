# Epic 008 — Infrastructure & operations  ·  DEFERRED (post-v1)

> **STATUS: DEFERRED to post-v1** (user scope decision, 2026-06-14). The user opted to
> deploy v1 **manually** following a written guide rather than build infrastructure
> automation now. The v1 manual path is documented in **`docs/DEPLOYMENT.md`**. This
> epic (IaC scaffold, automated tenant-provisioning script, migration lint) is the
> codify-it-later follow-up once deploy patterns stabilize. Do NOT schedule in v1.
>
> Note: for v1, tenant onboarding and local seeding are handled by an inline seed in
> `T1.7` (docker-compose) and the manual steps in `docs/DEPLOYMENT.md`. When this
> epic is later scheduled, `T8.1 provision-tenant.ts` becomes the single
> provisioning code path and the compose seed should call it.

Thin infra-ops epic: the operational pieces required to actually deploy and run the
multi-tenant SaaS on the chosen topology (Cloud Run + Cloud SQL + Secret Manager +
KMS, schema-per-tenant). This epic is **infrastructure required by the architecture
already decided** (devops.md), not new product scope — it carries no user-facing
features.

## Motivation
The deploy model in `devops.md` and the schema-per-tenant isolation in
`system-design.md` (GAP-6) require: a repeatable way to provision a tenant schema +
seed its admin role, infrastructure-as-code for the runtime environment, and a
documented per-tenant migration process. Without these the system cannot be stood up
in staging/prod or onboard a tenant.

## Definition of Done
- `scripts/provision-tenant.ts` creates a tenant schema, applies control-plane
  migrations to it, and seeds a tenant admin role (with `can_inspect_query` ON);
  one code path shared by local compose seed and prod onboarding.
- IaC scaffold (Terraform or Pulumi) describes Cloud Run + Cloud SQL + Secret Manager
  + KMS as a stub teams can extend (not a full production-hardened estate).
- A per-tenant schema-migration authoring guide exists, plus a CI lint check that
  catches migrations that would break schema-per-tenant isolation.

## Tasks
- T8.1 `scripts/provision-tenant.ts` — tenant schema + DDL + seeded admin role
- T8.2 IaC stub — Cloud Run + Cloud SQL + Secret Manager + KMS (scaffold scope)
- T8.3 Per-tenant migration authoring guide + CI lint check

## Dependency graph & parallelism plan

Wave 1 (parallel): T8.1, T8.2
Wave 2 (serial): T8.3

- T8.1 depends on 001 (control-plane schema + Prisma migrations) and the tenant
  registry from 002.
- T8.2 (IaC stub) is independent of T8.1 and can be authored in parallel.
- T8.3 depends on T8.1 (it documents and lints the migration flow T8.1 exercises).

## deps: 001, 002

## Risks / open questions
- IaC is intentionally a **stub** — provider hardening (VPC, IAM least-privilege,
  backups, alerting) is deferred; flag if production readiness is brought forward.
- `provision-tenant.ts` must stay the single tenant-creation code path; local
  compose seed (T1.7) should call it once this epic lands.
