## rbac-model

Control-plane schema (per-tenant schema; tenant scoping is structural).

```ts
interface Role {
  id: string;
  name: string;                // unique within tenant, ≤64 chars
  description?: string;        // ≤256
  capabilities: { canInspectQuery: boolean }; // per-role toggle (GAP-1 locked); default false
  createdAt: string; updatedAt: string;
}

interface ResourceGrant {        // additive; absence = no access
  roleId: string;
  dataSourceId: string;
  kind: "schema" | "table" | "column";
  schema: string;
  table?: string;              // required for table/column
  column?: string;             // required for column
}
type ResourceGrantSet = ResourceGrant[]; // effective grants for a role

interface User {
  id: string; email: string; displayName: string;
  status: "invited" | "active" | "suspended";
  roleId: string | null;       // single role per user in v1 (confirmed) — effective grants resolve from this one role
  authMethods: Array<"password" | "sso">;
  createdAt: string;
}

interface DataSource {
  id: string; name: string;
  type: "postgres" | "mysql" | "bigquery" | "rest";  // GAP-16 v1 set
  status: "connected" | "error" | "unconfigured";
  lastTestedAt?: string;
  // connection config + credentials stored encrypted (vault); never returned in API.
}
```

### RBAC / admin endpoints
- `GET/POST/PATCH/DELETE /api/admin/roles[/:id]` — role CRUD (FR-AC-1,2).
- `GET/PUT /api/admin/roles/:id/grants` — read/replace grant set in a batch (FR-AC-3; matches S5 "Save changes").
- `GET /api/admin/schema/:dataSourceId` — schema tree (schema>table>column+types) for the editor.
- `GET/PATCH /api/admin/users[/:id]` — list, assign role, suspend (FR-AC-7).
- `POST /api/admin/users/invite` — email invite (auth-flow).
- `GET/POST/PATCH/DELETE /api/admin/data-sources[/:id]` + `POST .../:id/test` (S7).
- `GET /api/admin/audit` — filtered, paginated audit events (S8; GAP-9 confirmed).

All `/api/admin/*` require an admin-capable role; non-admins get `TENANT`/`AUTH` errors.
