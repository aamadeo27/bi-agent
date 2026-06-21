import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../db/client.js";
import { validateTenantId, tenantSchema } from "../db/tenant-utils.js";

/**
 * Creates a fully-formed tenant_<id> schema with all per-tenant tables.
 * Safe to call multiple times — every statement uses IF NOT EXISTS.
 */
export async function provisionTenant(
  tenantId: string,
  client?: PrismaClient
): Promise<void> {
  validateTenantId(tenantId);
  const s = tenantSchema(tenantId); // e.g. "tenant_01abc"
  const db = client ?? getPrisma();

  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${s}"`);

      // Roles — RBAC roles with capability flags
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."roles" (
          "id"           TEXT         NOT NULL,
          "name"         VARCHAR(64)  NOT NULL,
          "description"  VARCHAR(256),
          "capabilities" JSONB        NOT NULL DEFAULT '{"canInspectQuery": false}',
          "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "${s}"."roles"("name")`
      );

      // Data sources — connection metadata + encrypted config
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."data_sources" (
          "id"               TEXT        NOT NULL,
          "name"             TEXT        NOT NULL,
          "type"             TEXT        NOT NULL,
          "status"           TEXT        NOT NULL DEFAULT 'unconfigured',
          "last_tested_at"   TIMESTAMPTZ,
          "config_encrypted" JSONB,
          "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
        )
      `);

      // Resource grants — additive read grants at schema/table/column level
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."resource_grants" (
          "id"             TEXT NOT NULL,
          "role_id"        TEXT NOT NULL,
          "data_source_id" TEXT NOT NULL,
          "kind"           TEXT NOT NULL,
          "schema"         TEXT NOT NULL,
          "table"          TEXT,
          "column"         TEXT,
          CONSTRAINT "resource_grants_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "resource_grants_role_fk"
            FOREIGN KEY ("role_id") REFERENCES "${s}"."roles"("id") ON DELETE CASCADE,
          CONSTRAINT "resource_grants_ds_fk"
            FOREIGN KEY ("data_source_id") REFERENCES "${s}"."data_sources"("id") ON DELETE CASCADE
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "resource_grants_role_idx" ON "${s}"."resource_grants"("role_id")`
      );

      // Users — tenant members
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."users" (
          "id"            TEXT        NOT NULL,
          "email"         TEXT        NOT NULL,
          "display_name"  TEXT        NOT NULL,
          "status"        TEXT        NOT NULL DEFAULT 'invited',
          "role_id"       TEXT,
          "auth_methods"  JSONB       NOT NULL DEFAULT '[]',
          "password_hash" TEXT,
          "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "users_role_fk"
            FOREIGN KEY ("role_id") REFERENCES "${s}"."roles"("id") ON DELETE SET NULL
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "${s}"."users"("email")`
      );
      // Idempotent backfill — safe to run on existing tenants
      await tx.$executeRawUnsafe(
        `ALTER TABLE "${s}"."users" ADD COLUMN IF NOT EXISTS "token_invalidated_at" TIMESTAMPTZ`
      );

      // Cred vault refs — encrypted per-(role,data_source) credentials
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."cred_vault_refs" (
          "id"              TEXT        NOT NULL,
          "data_source_id"  TEXT        NOT NULL,
          "role_id"         TEXT        NOT NULL,
          "encrypted_cred"  TEXT        NOT NULL,
          "key_ref"         TEXT        NOT NULL,
          "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "cred_vault_refs_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "cred_vault_refs_ds_fk"
            FOREIGN KEY ("data_source_id") REFERENCES "${s}"."data_sources"("id") ON DELETE CASCADE,
          CONSTRAINT "cred_vault_refs_role_fk"
            FOREIGN KEY ("role_id") REFERENCES "${s}"."roles"("id") ON DELETE CASCADE
        )
      `);

      // Conversations
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."conversations" (
          "id"         TEXT        NOT NULL,
          "user_id"    TEXT        NOT NULL,
          "title"      TEXT        NOT NULL DEFAULT '',
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "conversations_user_fk"
            FOREIGN KEY ("user_id") REFERENCES "${s}"."users"("id") ON DELETE CASCADE
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "conversations_user_idx" ON "${s}"."conversations"("user_id")`
      );

      // Messages
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."messages" (
          "id"              TEXT        NOT NULL,
          "conversation_id" TEXT        NOT NULL,
          "role"            TEXT        NOT NULL,
          "content"         TEXT        NOT NULL,
          "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "messages_conv_fk"
            FOREIGN KEY ("conversation_id") REFERENCES "${s}"."conversations"("id") ON DELETE CASCADE
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "messages_conv_idx" ON "${s}"."messages"("conversation_id")`
      );

      // Audit events — immutable log; no FK to keep insert fast under load
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${s}"."audit_events" (
          "id"                 TEXT        NOT NULL,
          "tenant_id"          TEXT        NOT NULL,
          "at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "actor_user_id"      TEXT        NOT NULL,
          "role_name_at_event" TEXT        NOT NULL,
          "type"               TEXT        NOT NULL,
          "outcome"            TEXT        NOT NULL,
          "data_source_id"     TEXT,
          "detail"             JSONB       NOT NULL DEFAULT '{}',
          "ip"                 TEXT,
          CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "audit_events_at_idx" ON "${s}"."audit_events"("at")`
      );
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "${s}"."audit_events"("actor_user_id")`
      );
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}
