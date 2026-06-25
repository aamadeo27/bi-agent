import { z } from "zod";

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string().max(64),
  description: z.string().max(256).optional(),
  capabilities: z.object({
    canInspectQuery: z.boolean(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Role = z.infer<typeof RoleSchema>;

/** Additive grant — absence means no access. */
export const ResourceGrantSchema = z.object({
  roleId: z.string(),
  dataSourceId: z.string(),
  kind: z.enum(["schema", "table", "column"]),
  schema: z.string(),
  table: z.string().optional(),
  column: z.string().optional(),
});
export type ResourceGrant = z.infer<typeof ResourceGrantSchema>;

export const ResourceGrantSetSchema = z.array(ResourceGrantSchema);
export type ResourceGrantSet = z.infer<typeof ResourceGrantSetSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  status: z.enum(["invited", "active", "suspended"]),
  roleId: z.string().nullable(),
  authMethods: z.array(z.enum(["password", "sso"])),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const DataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["postgres", "mysql", "bigquery", "rest"]),
  status: z.enum(["connected", "error", "unconfigured"]),
  lastTestedAt: z.string().datetime().optional(),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

// ── Schema tree (GET /api/admin/schema/:dataSourceId) ─────────────────────────

export const SchemaColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type SchemaColumn = z.infer<typeof SchemaColumnSchema>;

export const SchemaTableSchema = z.object({
  name: z.string(),
  columns: z.array(SchemaColumnSchema),
});
export type SchemaTable = z.infer<typeof SchemaTableSchema>;

export const SchemaSchemaSchema = z.object({
  name: z.string(),
  tables: z.array(SchemaTableSchema),
});
export type SchemaSchemaObj = z.infer<typeof SchemaSchemaSchema>;

export const SchemaTreeSchema = z.object({
  dataSourceId: z.string(),
  schemas: z.array(SchemaSchemaSchema),
});
export type SchemaTree = z.infer<typeof SchemaTreeSchema>;
