import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { z } from "zod";
import type { ApiErrorResponse } from "@bi/contracts";
import { DataSourceSchema } from "@bi/contracts";
import { logger } from "../observability/logger.js";
import { encryptCredential } from "../datasource/vault.js";
import { emitAdminAudit } from "../audit/index.js";

export const dataSourcesRouter: ExpressRouter = Router();

// ── Request body schemas ──────────────────────────────────────────────────────

const DataSourceTypeSchema = z.enum(["postgres", "mysql", "bigquery", "rest"]);

const CreateDataSourceBodySchema = z.object({
  name: z.string().min(1).max(256),
  type: DataSourceTypeSchema,
  // Write-only: connection config is encrypted at rest; never returned in responses.
  connectionConfig: z.record(z.unknown()).optional(),
});

const PatchDataSourceBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  type: DataSourceTypeSchema.optional(),
  status: z.enum(["connected", "error", "unconfigured"]).optional(),
  // Write-only: re-encrypts and replaces the stored config when present.
  connectionConfig: z.record(z.unknown()).optional(),
});

// ── DB row type ───────────────────────────────────────────────────────────────

interface DataSourceRow {
  id: string;
  name: string;
  type: string;
  status: string;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // config_encrypted intentionally excluded from SELECT — never emitted.
}

function mapRow(row: DataSourceRow): z.infer<typeof DataSourceSchema> {
  return {
    id: row.id,
    name: row.name,
    type: row.type as "postgres" | "mysql" | "bigquery" | "rest",
    status: row.status as "connected" | "error" | "unconfigured",
    ...(row.last_tested_at ? { lastTestedAt: row.last_tested_at.toISOString() } : {}),
  };
}

// ── GET /api/admin/data-sources ───────────────────────────────────────────────

dataSourcesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await req.withTenantTx!<DataSourceRow[]>((tx) =>
      tx.$queryRawUnsafe<DataSourceRow[]>(
        `SELECT id, name, type, status, last_tested_at, created_at, updated_at
         FROM data_sources
         ORDER BY name`,
      ),
    );
    res.json(rows.map(mapRow));
  } catch (err) {
    logger.error(err, "data-sources GET / error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to list data sources" };
    res.status(500).json(body);
  }
});

// ── GET /api/admin/data-sources/:id ──────────────────────────────────────────

dataSourcesRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await req.withTenantTx!<DataSourceRow[]>((tx) =>
      tx.$queryRawUnsafe<DataSourceRow[]>(
        `SELECT id, name, type, status, last_tested_at, created_at, updated_at
         FROM data_sources
         WHERE id = $1`,
        id,
      ),
    );
    if (!rows.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Data source not found" };
      res.status(404).json(body);
      return;
    }
    res.json(mapRow(rows[0]));
  } catch (err) {
    logger.error(err, "data-sources GET /:id error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch data source" };
    res.status(500).json(body);
  }
});

// ── POST /api/admin/data-sources ─────────────────────────────────────────────

dataSourcesRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateDataSourceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
    res.status(400).json(body);
    return;
  }

  const { name, type, connectionConfig } = parsed.data;
  const id = crypto.randomUUID();
  // Encrypt connection config before any DB write; never log plaintext.
  const configEncryptedJson = connectionConfig
    ? JSON.stringify({ enc: encryptCredential(connectionConfig) })
    : null;

  try {
    const rows = await req.withTenantTx!<DataSourceRow[]>((tx) =>
      tx.$queryRawUnsafe<DataSourceRow[]>(
        `INSERT INTO data_sources (id, name, type, status, config_encrypted, created_at, updated_at)
         VALUES ($1, $2, $3, 'unconfigured', $4::jsonb, NOW(), NOW())
         RETURNING id, name, type, status, last_tested_at, created_at, updated_at`,
        id,
        name,
        type,
        configEncryptedJson,
      ),
    );
    res.status(201).json(mapRow(rows[0]));
    emitAdminAudit(req.auth!, typeof req.ip === "string" ? req.ip : undefined, {
      type: "data_source_changed",
      outcome: "success",
      dataSourceId: id,
      detail: { action: "created", name, dsType: type },
    });
  } catch (err) {
    logger.error(err, "data-sources POST error");
    const body: ApiErrorResponse = {
      code: "INTERNAL",
      message: "Failed to create data source",
    };
    res.status(500).json(body);
  }
});

// ── PATCH /api/admin/data-sources/:id ────────────────────────────────────────

dataSourcesRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = PatchDataSourceBodySchema.safeParse(req.body);
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
    const updated = await req.withTenantTx!<DataSourceRow[]>(async (tx) => {
      const current = await tx.$queryRawUnsafe<DataSourceRow[]>(
        `SELECT id, name, type, status, last_tested_at, created_at, updated_at
         FROM data_sources WHERE id = $1 FOR UPDATE`,
        id,
      );
      if (!current.length) return [];

      const newName = data.name ?? current[0].name;
      const newType = data.type ?? current[0].type;
      const newStatus = data.status ?? current[0].status;

      if (data.connectionConfig !== undefined) {
        // Encrypt and replace connection config.
        const configEncryptedJson = JSON.stringify({
          enc: encryptCredential(data.connectionConfig),
        });
        return tx.$queryRawUnsafe<DataSourceRow[]>(
          `UPDATE data_sources
           SET name = $2, type = $3, status = $4, config_encrypted = $5::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, type, status, last_tested_at, created_at, updated_at`,
          id,
          newName,
          newType,
          newStatus,
          configEncryptedJson,
        );
      }

      return tx.$queryRawUnsafe<DataSourceRow[]>(
        `UPDATE data_sources
         SET name = $2, type = $3, status = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, type, status, last_tested_at, created_at, updated_at`,
        id,
        newName,
        newType,
        newStatus,
      );
    });

    if (!updated.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Data source not found" };
      res.status(404).json(body);
      return;
    }
    res.json(mapRow(updated[0]));
    emitAdminAudit(req.auth!, typeof req.ip === "string" ? req.ip : undefined, {
      type: "data_source_changed",
      outcome: "success",
      dataSourceId: String(id),
      detail: { action: "updated", name: updated[0].name, dsType: updated[0].type },
    });
  } catch (err) {
    logger.error(err, "data-sources PATCH /:id error");
    const body: ApiErrorResponse = {
      code: "INTERNAL",
      message: "Failed to update data source",
    };
    res.status(500).json(body);
  }
});

// ── DELETE /api/admin/data-sources/:id ───────────────────────────────────────

dataSourcesRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await req.withTenantTx!<Array<{ id: string }>>((tx) =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(
        `DELETE FROM data_sources WHERE id = $1 RETURNING id`,
        id,
      ),
    );
    if (!rows.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Data source not found" };
      res.status(404).json(body);
      return;
    }
    res.status(204).send();
    emitAdminAudit(req.auth!, typeof req.ip === "string" ? req.ip : undefined, {
      type: "data_source_changed",
      outcome: "success",
      dataSourceId: String(id),
      detail: { action: "deleted" },
    });
  } catch (err) {
    logger.error(err, "data-sources DELETE /:id error");
    const body: ApiErrorResponse = {
      code: "INTERNAL",
      message: "Failed to delete data source",
    };
    res.status(500).json(body);
  }
});
