import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { ApiErrorResponse } from "@bi/contracts";
import { RoleSchema } from "@bi/contracts";
import { logger } from "../observability/logger.js";

export const rolesRouter = Router();

// ── Request body schemas ──────────────────────────────────────────────────────

const CreateRoleBodySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  capabilities: z
    .object({ canInspectQuery: z.boolean() })
    .optional()
    .default({ canInspectQuery: false }),
});

const PatchRoleBodySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  // null explicitly clears description; undefined = not provided (keep existing)
  description: z.string().max(256).nullable().optional(),
  capabilities: z.object({ canInspectQuery: z.boolean() }).optional(),
});

// ── DB row type ───────────────────────────────────────────────────────────────

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  capabilities: { canInspectQuery: boolean };
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: RoleRow): z.infer<typeof RoleSchema> {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    capabilities: row.capabilities,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ── GET /api/admin/roles ──────────────────────────────────────────────────────

rolesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await req.withTenantTx!<RoleRow[]>((tx) =>
      tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, capabilities, created_at, updated_at
         FROM roles
         ORDER BY name`,
      ),
    );
    res.json(rows.map(mapRow));
  } catch (err) {
    logger.error(err, "roles GET / error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to list roles" };
    res.status(500).json(body);
  }
});

// ── GET /api/admin/roles/:id ──────────────────────────────────────────────────

rolesRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await req.withTenantTx!<RoleRow[]>((tx) =>
      tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, capabilities, created_at, updated_at
         FROM roles
         WHERE id = $1`,
        id,
      ),
    );
    if (!rows.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Role not found" };
      res.status(404).json(body);
      return;
    }
    res.json(mapRow(rows[0]));
  } catch (err) {
    logger.error(err, "roles GET /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch role" };
    res.status(500).json(body);
  }
});

// ── POST /api/admin/roles ─────────────────────────────────────────────────────

rolesRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateRoleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
    res.status(400).json(body);
    return;
  }

  const { name, description, capabilities } = parsed.data;
  const id = crypto.randomUUID();

  try {
    const rows = await req.withTenantTx!<RoleRow[]>((tx) =>
      tx.$queryRawUnsafe<RoleRow[]>(
        `INSERT INTO roles (id, name, description, capabilities, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
         RETURNING id, name, description, capabilities, created_at, updated_at`,
        id,
        name,
        description ?? null,
        JSON.stringify(capabilities),
      ),
    );
    res.status(201).json(mapRow(rows[0]));
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: `Role name "${name}" already exists`,
      };
      res.status(400).json(body);
      return;
    }
    logger.error(err, "roles POST error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to create role" };
    res.status(500).json(body);
  }
});

// ── PATCH /api/admin/roles/:id ────────────────────────────────────────────────

rolesRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = PatchRoleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
    res.status(400).json(body);
    return;
  }

  const data = parsed.data;

  try {
    const updated = await req.withTenantTx!<RoleRow[]>(async (tx) => {
      // Fetch current state inside the same transaction (SELECT FOR UPDATE)
      const current = await tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, capabilities, created_at, updated_at
         FROM roles WHERE id = $1 FOR UPDATE`,
        id,
      );
      if (!current.length) return [];

      const newName = data.name ?? current[0].name;
      const newDesc =
        "description" in data ? data.description : current[0].description;
      const newCaps = data.capabilities ?? current[0].capabilities;

      return tx.$queryRawUnsafe<RoleRow[]>(
        `UPDATE roles
         SET name = $2, description = $3, capabilities = $4::jsonb, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, description, capabilities, created_at, updated_at`,
        id,
        newName,
        newDesc ?? null,
        JSON.stringify(newCaps),
      );
    });

    if (!updated.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Role not found" };
      res.status(404).json(body);
      return;
    }
    res.json(mapRow(updated[0]));
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: `Role name "${data.name}" already exists`,
      };
      res.status(400).json(body);
      return;
    }
    logger.error(err, "roles PATCH /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to update role" };
    res.status(500).json(body);
  }
});

// ── DELETE /api/admin/roles/:id ───────────────────────────────────────────────

rolesRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await req.withTenantTx!<{ deleted: boolean; affectedUsers: number }>(
      async (tx) => {
        // Count users assigned to this role before deleting
        const countRows = await tx.$queryRawUnsafe<[{ count: string }]>(
          `SELECT COUNT(*)::text AS count FROM users WHERE role_id = $1`,
          id,
        );
        const affectedUsers = parseInt(countRows[0].count, 10);

        // Delete the role (users.role_id → SET NULL via FK cascade in schema)
        const deleted = await tx.$queryRawUnsafe<[{ id: string }]>(
          `DELETE FROM roles WHERE id = $1 RETURNING id`,
          id,
        );

        return { deleted: deleted.length > 0, affectedUsers };
      },
    );

    if (!result.deleted) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Role not found" };
      res.status(404).json(body);
      return;
    }

    res.json({ affectedUsers: result.affectedUsers });
  } catch (err) {
    logger.error(err, "roles DELETE /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to delete role" };
    res.status(500).json(body);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ("code" in err
      ? (err as { code: string }).code === "23505"
      : "message" in err &&
        typeof (err as { message: string }).message === "string" &&
        (err as { message: string }).message.includes("unique"))
  );
}
