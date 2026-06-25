import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { z } from "zod";
import { InviteUserRequestSchema, UserSchema } from "@bi/contracts";
import type { ApiErrorResponse } from "@bi/contracts";
import { createInvite } from "../auth/invite-service.js";
import { consoleMailer } from "../mailer/console-adapter.js";
import { getPrisma } from "../db/client.js";
import { logger } from "../observability/logger.js";
import { requireAdminCapability } from "./require-admin.js";

export const adminUsersRouter: ExpressRouter = Router();

/**
 * POST /api/admin/users/invite
 *
 * Creates an `invited` user and dispatches a signed, expiring invite token.
 *
 * SECURITY RISK (known, tracked as T3.x): the current admin guard only checks
 * that the caller has *any* role assigned (roleId !== null). Any authenticated
 * user with a role can therefore invite new users. This is intentionally
 * over-permissive until the T3.x RBAC admin layer defines a `canAdmin`
 * capability and gates this endpoint on it. Do not promote this pattern to
 * other sensitive write endpoints.
 */
adminUsersRouter.post("/invite", async (req: Request, res: Response) => {
  // req.auth is guaranteed non-null here — protectedRouter runs authMiddleware
  // before any handler under /api, so this branch is only reached with a valid JWT.
  const auth = req.auth!;

  // Temporary admin gate: any user with an assigned role may invite.
  // Replace with capability check once T3.x ships.
  if (!auth.roleId) {
    const body: ApiErrorResponse = {
      code: "AUTH",
      message: "Admin role required",
    };
    res.status(403).json(body);
    return;
  }

  const parsed = InviteUserRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: "email and displayName are required",
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await createInvite(
      {
        tenantId: auth.tenantId,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        roleId: parsed.data.roleId,
        invitedByUserId: auth.userId,
      },
      getPrisma(),
      consoleMailer
    );
    res.status(201).json(result);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "VALIDATION") {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: (err as Error).message,
      };
      res.status(400).json(body);
      return;
    }
    logger.error(err, "invite error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Invite failed" };
    res.status(500).json(body);
  }
});

// ── DB row type ───────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: "invited" | "active" | "suspended";
  role_id: string | null;
  auth_methods: Array<"password" | "sso">;
  created_at: Date;
}

function mapUserRow(row: UserRow): z.infer<typeof UserSchema> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    roleId: row.role_id,
    authMethods: row.auth_methods,
    createdAt: row.created_at.toISOString(),
  };
}

// ── PATCH request body ────────────────────────────────────────────────────────

const PatchUserBodySchema = z
  .object({
    roleId: z.string().nullable().optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((d) => d.roleId !== undefined || d.status !== undefined, {
    message: "At least one of roleId or status must be provided",
  });

// ── GET /api/admin/users ──────────────────────────────────────────────────────

adminUsersRouter.get("/", requireAdminCapability, async (req: Request, res: Response) => {
  try {
    const rows = await req.withTenantTx!<UserRow[]>((tx) =>
      tx.$queryRawUnsafe<UserRow[]>(
        `SELECT id, email, display_name, status, role_id, auth_methods, created_at
         FROM users
         ORDER BY created_at`,
      ),
    );
    res.json(rows.map(mapUserRow));
  } catch (err) {
    logger.error(err, "users GET / error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to list users" };
    res.status(500).json(body);
  }
});

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────

adminUsersRouter.get("/:id", requireAdminCapability, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await req.withTenantTx!<UserRow[]>((tx) =>
      tx.$queryRawUnsafe<UserRow[]>(
        `SELECT id, email, display_name, status, role_id, auth_methods, created_at
         FROM users
         WHERE id = $1`,
        id,
      ),
    );
    if (!rows.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "User not found" };
      res.status(404).json(body);
      return;
    }
    res.json(mapUserRow(rows[0]));
  } catch (err) {
    logger.error(err, "users GET /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch user" };
    res.status(500).json(body);
  }
});

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────

adminUsersRouter.patch("/:id", requireAdminCapability, async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = PatchUserBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
    res.status(400).json(body);
    return;
  }

  const { roleId, status } = parsed.data;

  try {
    // Step 1: update tenant-schema users row atomically (SELECT FOR UPDATE → UPDATE)
    const updated = await req.withTenantTx!<UserRow[] | null>(async (tx) => {
      const current = await tx.$queryRawUnsafe<UserRow[]>(
        `SELECT id, email, display_name, status, role_id, auth_methods, created_at
         FROM users WHERE id = $1 FOR UPDATE`,
        id,
      );
      if (!current.length) return null;

      const newRoleId = roleId !== undefined ? roleId : current[0].role_id;
      const newStatus = status !== undefined ? status : current[0].status;

      return tx.$queryRawUnsafe<UserRow[]>(
        `UPDATE users
         SET role_id = $2, status = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, display_name, status, role_id, auth_methods, created_at`,
        id,
        newRoleId,
        newStatus,
      );
    });

    if (!updated || !updated.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "User not found" };
      res.status(404).json(body);
      return;
    }

    // Step 2: sync platform.users so GAP-17 token refresh picks up the new roleId/status.
    // This is the source read by auth-service.ts refresh() when rotating tokens.
    const platformData: { roleId?: string | null; status?: "active" | "suspended" } = {};
    if (roleId !== undefined) platformData.roleId = roleId;
    if (status !== undefined) platformData.status = status;
    await getPrisma().user.update({ where: { id }, data: platformData });

    res.json(mapUserRow(updated[0]));
  } catch (err) {
    logger.error(err, "users PATCH /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to update user" };
    res.status(500).json(body);
  }
});
