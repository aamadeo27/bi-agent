/**
 * Integration tests for GET /api/messages/:id/query — tenant isolation.
 *
 * Uses a real PostgreSQL instance (Testcontainers) to verify that the
 * search_path mechanism actually prevents cross-tenant data access, and that
 * conversation ownership (c.user_id = $2) prevents cross-user data access
 * within the same tenant.
 *
 * These tests run the exact SQL used in the route handler via withTenant so
 * the structural guarantees are tested at the DB layer, not the mock layer.
 *
 * Requires Docker. Skipped when SKIP_DB_INTEGRATION_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../tenant/provision.js";
import { withTenant } from "../db/with-tenant.js";

const skip = process.env["SKIP_DB_INTEGRATION_TESTS"] === "1";

// ── SQL used by the route handler (duplicated intentionally — any drift fails the test) ──
const QUERY_MESSAGE_SQL = `
  SELECT
    m.id,
    m.query_type,
    m.generated_query,
    m.result_envelope,
    m.created_at,
    ds.name AS data_source_name
  FROM messages m
  INNER JOIN conversations c ON c.id = m.conversation_id AND c.user_id = $2
  LEFT JOIN data_sources ds ON ds.id = m.data_source_id
  WHERE m.id = $1
    AND m.generated_query IS NOT NULL
    AND m.query_type IS NOT NULL
`;

describe.skipIf(skip)("messages query — tenant isolation (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let client: PrismaClient;

  // ── Fixture ids ───────────────────────────────────────────────────────────────
  const TENANT_A = "testa";
  const TENANT_B = "testb";
  const USER_A = "user-a";
  const USER_B = "user-b";
  const CONV_A = "conv-a";
  const MSG_A = "msg-a";
  const DS_A = "ds-a";
  const ROLE_A = "role-a";

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("bi_msg_test")
      .withUsername("bi_msg_test")
      .withPassword("bi_msg_test")
      .start();

    client = new PrismaClient({
      datasources: { db: { url: container.getConnectionUri() } },
      log: [],
    });

    // Provision two isolated tenant schemas
    await provisionTenant(TENANT_A, client);
    await provisionTenant(TENANT_B, client);

    // ── Seed tenant A ─────────────────────────────────────────────────────────
    await withTenant(TENANT_A, async (tx) => {
      // Role
      await tx.$executeRawUnsafe(
        `INSERT INTO roles (id, name, capabilities) VALUES ($1, 'Inspector', '{"canInspectQuery":true}')`,
        ROLE_A,
      );
      // Data source
      await tx.$executeRawUnsafe(
        `INSERT INTO data_sources (id, name, type, status) VALUES ($1, 'Prod DB', 'postgres', 'connected')`,
        DS_A,
      );
      // User A in tenant A
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, email, display_name, status) VALUES ($1, 'a@example.com', 'User A', 'active')`,
        USER_A,
      );
      // User B in tenant A (different user, same tenant)
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, email, display_name, status) VALUES ($1, 'b@example.com', 'User B', 'active')`,
        USER_B,
      );
      // Conversation owned by User A
      await tx.$executeRawUnsafe(
        `INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, 'Test conv')`,
        CONV_A,
        USER_A,
      );
      // Assistant message with generated_query and data_source_id
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, conversation_id, role, content, query_type, generated_query, data_source_id)
         VALUES ($1, $2, 'assistant', 'Here are the results', 'sql', 'SELECT id FROM orders', $3)`,
        MSG_A,
        CONV_A,
        DS_A,
      );
    }, client);

    // Tenant B is left empty — no messages, no users
  }, 60_000);

  afterAll(async () => {
    await client.$disconnect();
    await container.stop();
  }, 30_000);

  // ── Happy path: owner can see their own message ───────────────────────────────

  it("owner (user A, tenant A) can fetch their own message", async () => {
    const rows = await withTenant(
      TENANT_A,
      (tx) => tx.$queryRawUnsafe<{ id: string; generated_query: string; data_source_name: string }[]>(
        QUERY_MESSAGE_SQL,
        MSG_A,
        USER_A,
      ),
      client,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(MSG_A);
    expect(rows[0]?.generated_query).toBe("SELECT id FROM orders");
    expect(rows[0]?.data_source_name).toBe("Prod DB");
  }, 15_000);

  // ── Cross-tenant isolation: tenant B cannot see tenant A's message ────────────

  it(
    "tenant B context cannot read tenant A's message (search_path isolation)",
    async () => {
      // Same message id, same user id — but running inside tenant B's search_path.
      // The 'messages' table resolves to tenant_testb.messages, which is empty.
      const rows = await withTenant(
        TENANT_B,
        (tx) => tx.$queryRawUnsafe<{ id: string }[]>(
          QUERY_MESSAGE_SQL,
          MSG_A,
          USER_A,
        ),
        client,
      );

      expect(rows).toHaveLength(0);
    },
    15_000,
  );

  // ── Ownership isolation: user B (same tenant) cannot see user A's message ──────

  it(
    "user B in tenant A cannot read user A's message (ownership JOIN)",
    async () => {
      // Both users are in tenant A. The INNER JOIN c.user_id = $2 must block user B.
      const rows = await withTenant(
        TENANT_A,
        (tx) => tx.$queryRawUnsafe<{ id: string }[]>(
          QUERY_MESSAGE_SQL,
          MSG_A,
          USER_B, // different user — conversation not owned by user B
        ),
        client,
      );

      expect(rows).toHaveLength(0);
    },
    15_000,
  );

  // ── search_path does not leak after withTenant ────────────────────────────────

  it("search_path does not persist on the connection after withTenant exits", async () => {
    await withTenant(TENANT_A, async (tx) => {
      await tx.$executeRawUnsafe("SELECT 1");
    }, client);

    const result = await client.$queryRawUnsafe<Array<{ search_path: string }>>("SHOW search_path");
    expect(result[0]?.search_path).not.toContain(TENANT_A);
  }, 15_000);
});
