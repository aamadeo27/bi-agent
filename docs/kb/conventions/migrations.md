# Migrations

- **Control plane only** uses Prisma Migrate (see tech-stack/prisma.md). Migrations live under `apps/api/src/db/migrations/`.
- Per-tenant schemas are created by the provisioning routine with raw, idempotent DDL (`CREATE SCHEMA/TABLE IF NOT EXISTS`), NOT Prisma Migrate.
- Never run Prisma against a tenant data source (data plane uses raw drivers).
