# S4: Admin — Role Management

**Purpose:** CRUD operations on roles within the tenant.
**Layout:** Full-width content area with admin sidebar on left (160px).
**Admin sidebar links:** Roles (active), Users, Data Sources, Audit Log.
**Role list:** Table or card grid (table preferred for scannability):
- Columns: Role name | Description | # Users | # Permissions (schema/table/column grants) | Actions.
- Actions per row: "Edit permissions" (navigates to S5) | "Edit details" (opens modal) | "Delete" (confirm modal).
- Empty state: "No roles yet. Create your first role to start assigning permissions." + "New role" button.
- Search/filter bar above table.
**Create role modal (from "New role" button):**
- Role name: text input, required, validated on submit (unique within tenant).
- Description: textarea, optional.
- Buttons: "Create role" (primary) | "Cancel" (secondary).
**Delete role confirm modal:**
- Warning: "Deleting '[name]' will remove access for [N] users assigned this role. This cannot be undone."
- Confirm (destructive, `color-semantic-error` fill) | Cancel.
**FR coverage:** FR-AC-1, FR-AC-2.
