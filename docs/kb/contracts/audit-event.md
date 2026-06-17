## audit-event

Persisted (GAP-9 confirmed). Powers Admin Audit Log (S8) and security review.
Audit retention follows the GAP-4 365-day default (purged by the same/parallel job).
```ts
interface AuditEvent {
  id: string; tenantId: string;
  at: string;                  // ISO-8601 UTC
  actorUserId: string; roleNameAtEvent: string;
  type: "query_executed" | "query_blocked" | "query_validation_failed"
      | "export" | "role_changed" | "permission_changed"
      | "user_role_assigned" | "data_source_changed" | "login" | "login_failed";
  outcome: "success" | "blocked" | "error";
  dataSourceId?: string;
  detail: Record<string, unknown>; // e.g. { queryText, missing[], rowCount } — no row data
  ip?: string;
}
```
- `query_blocked` records the `missing[]` resources, not the data.
- `detail` must never contain queried row values (PII guard).
