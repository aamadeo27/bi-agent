import { Router, type Router as ExpressRouter } from "express";
import { hash, verify } from "argon2";
import type { ApiErrorResponse, MeResponse } from "@bi/contracts";
import { UpdateMeRequestSchema, ChangePasswordRequestSchema } from "@bi/contracts";
import { z } from "zod";
import { getPrisma } from "../db/client.js";
import { logger } from "../observability/logger.js";

const UserStatusSchema = z.enum(["invited", "active", "suspended"]);

export const meRouter: ExpressRouter = Router();

// ─── Row types (raw Postgres results) ────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  role_id: string | null;
  auth_methods: string; // JSON array
}

interface RoleRow {
  id: string;
  name: string;
  capabilities: string; // JSON object
}

// ─── GET /api/me ─────────────────────────────────────────────────────────────

meRouter.get("/", async (req, res) => {
  const { userId, tenantId } = req.auth!;

  try {
    const data = await req.withTenantTx!(async (tx) => {
      // Fetch user from tenant schema (search_path already set)
      const users = await tx.$queryRawUnsafe<UserRow[]>(
        `SELECT id, email, display_name, status, role_id, auth_methods::text
         FROM users WHERE id = $1`,
        userId,
      );
      const user = users[0];
      if (!user) return null;

      // Fetch role if assigned
      let roleRow: RoleRow | null = null;
      if (user.role_id) {
        const roles = await tx.$queryRawUnsafe<RoleRow[]>(
          `SELECT id, name, capabilities::text FROM roles WHERE id = $1`,
          user.role_id,
        );
        roleRow = roles[0] ?? null;
      }

      return { user, roleRow };
    });

    if (!data) {
      const err: ApiErrorResponse = { code: "NOT_FOUND", message: "User not found" };
      res.status(404).json(err);
      return;
    }

    // Tenant comes from the platform schema — query directly (not tenant-scoped)
    const db = getPrisma();
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      const err: ApiErrorResponse = { code: "TENANT", message: "Tenant not found" };
      res.status(403).json(err);
      return;
    }

    const { user, roleRow } = data;

    let capabilities = { canInspectQuery: false, isAdmin: false };
    if (roleRow) {
      const caps = JSON.parse(roleRow.capabilities) as {
        canInspectQuery?: boolean;
        isAdmin?: boolean;
      };
      capabilities = {
        canInspectQuery: Boolean(caps.canInspectQuery),
        isAdmin: Boolean(caps.isAdmin),
      };
    }

    const authMethods = JSON.parse(user.auth_methods) as Array<"password" | "sso">;

    const body: MeResponse = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: UserStatusSchema.parse(user.status),
        authMethods,
      },
      role: roleRow ? { id: roleRow.id, name: roleRow.name } : null,
      capabilities,
      tenant: { id: tenant.id, displayName: tenant.displayName },
    };

    res.json(body);
  } catch (err) {
    logger.error({ err }, "GET /me: failed to fetch profile");
    const errBody: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch profile" };
    res.status(500).json(errBody);
  }
});

// ─── PATCH /api/me ────────────────────────────────────────────────────────────

meRouter.patch("/", async (req, res) => {
  const parsed = UpdateMeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const err: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.errors[0]?.message ?? "Invalid request",
    };
    res.status(400).json(err);
    return;
  }

  const { userId } = req.auth!;
  const { displayName } = parsed.data;

  try {
    await req.withTenantTx!(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2`,
        displayName,
        userId,
      );
    });
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "PATCH /me: failed to update profile");
    const errBody: ApiErrorResponse = { code: "INTERNAL", message: "Failed to update profile" };
    res.status(500).json(errBody);
  }
});

// ─── POST /api/me/password ────────────────────────────────────────────────────

meRouter.post("/password", async (req, res) => {
  const parsed = ChangePasswordRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const err: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.errors[0]?.message ?? "Invalid request",
    };
    res.status(400).json(err);
    return;
  }

  const { userId } = req.auth!;
  const { currentPassword, newPassword } = parsed.data;

  try {
    // Read user (password_hash + auth_methods)
    const user = await req.withTenantTx!(async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ password_hash: string | null; auth_methods: string }>
      >(
        `SELECT password_hash, auth_methods::text FROM users WHERE id = $1`,
        userId,
      );
      return rows[0] ?? null;
    });

    if (!user) {
      const err: ApiErrorResponse = { code: "NOT_FOUND", message: "User not found" };
      res.status(404).json(err);
      return;
    }

    const authMethods = JSON.parse(user.auth_methods) as string[];
    if (!authMethods.includes("password") || !user.password_hash) {
      const err: ApiErrorResponse = {
        code: "VALIDATION",
        message: "Password authentication is not enabled for this account",
      };
      res.status(400).json(err);
      return;
    }

    const valid = await verify(user.password_hash, currentPassword);
    if (!valid) {
      const err: ApiErrorResponse = {
        code: "AUTH",
        message: "Current password is incorrect",
      };
      res.status(401).json(err);
      return;
    }

    const newHash = await hash(newPassword);
    await req.withTenantTx!(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        newHash,
        userId,
      );
    });

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "POST /me/password: failed to change password");
    const errBody: ApiErrorResponse = { code: "INTERNAL", message: "Failed to change password" };
    res.status(500).json(errBody);
  }
});

// ─── POST /api/me/logout-all ─────────────────────────────────────────────────

meRouter.post("/logout-all", async (req, res) => {
  const { userId } = req.auth!;

  try {
    await req.withTenantTx!(async (tx) => {
      // Idempotent column guard — ensures the column exists for tenants provisioned
      // before the token_invalidated_at migration was introduced.
      await tx.$executeRawUnsafe(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "token_invalidated_at" TIMESTAMPTZ`,
      );
      await tx.$executeRawUnsafe(
        `UPDATE users SET token_invalidated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        userId,
      );
    });
    // The access token must be cleared client-side (it is in-memory in the SPA).
    // Refresh tokens for other sessions will be rejected once the auth module
    // checks token_invalidated_at on each /auth/refresh call (TODO: auth T2.x).
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "POST /me/logout-all: failed to invalidate sessions");
    const errBody: ApiErrorResponse = { code: "INTERNAL", message: "Failed to sign out all sessions" };
    res.status(500).json(errBody);
  }
});
