import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import type { ApiErrorResponse, SchemaTree } from "@bi/contracts";
import { logger } from "../observability/logger.js";

export const schemaRouter: ExpressRouter = Router();

interface DataSourceRow {
  id: string;
  status: string;
}

// ── GET /api/admin/schema/:dataSourceId ──────────────────────────────────────
//
// Returns the schema > table > column+type tree for the given data source.
// Actual connector-based introspection is implemented in T4 (datasource connectors).
// Until then, connected data sources return an empty schema list; the shape is
// already correct for the S5 grant editor.

schemaRouter.get("/:dataSourceId", async (req: Request, res: Response) => {
  const dataSourceId = req.params["dataSourceId"] as string;

  try {
    const rows = await req.withTenantTx!<DataSourceRow[]>((tx) =>
      tx.$queryRawUnsafe<DataSourceRow[]>(
        `SELECT id, status FROM data_sources WHERE id = $1`,
        dataSourceId,
      ),
    );

    if (!rows.length) {
      const body: ApiErrorResponse = { code: "NOT_FOUND", message: "Data source not found" };
      res.status(404).json(body);
      return;
    }

    const tree: SchemaTree = { dataSourceId, schemas: [] };
    res.json(tree);
  } catch (err) {
    logger.error(err, "schema GET error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Failed to fetch schema" };
    res.status(500).json(body);
  }
});
