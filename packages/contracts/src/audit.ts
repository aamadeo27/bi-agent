import { z } from "zod";

export const AuditEventTypeSchema = z.enum([
  "query_executed",
  "query_blocked",
  "query_validation_failed",
  "export",
  "role_changed",
  "permission_changed",
  "user_role_assigned",
  "data_source_changed",
  "login",
  "login_failed",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  at: z.string().datetime(),
  actorUserId: z.string(),
  roleNameAtEvent: z.string(),
  type: AuditEventTypeSchema,
  outcome: z.enum(["success", "blocked", "error"]),
  dataSourceId: z.string().optional(),
  /** Must never contain queried row values (PII guard). */
  detail: z.record(z.unknown()),
  ip: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
