# S5: Admin — Permission Editor

**Purpose:** Assign or revoke schema/table/column read access for a specific role.
**Entry:** From S4 role row "Edit permissions" action.
**Layout:** Two-panel split (no admin sidebar — focused editing mode with breadcrumb back to S4).
- Breadcrumb: "Admin > Roles > [Role Name] > Permissions".
- Header: role name + current unsaved-changes badge.
- "Save changes" button (primary) | "Cancel" link | top-right.

**Left panel — Schema browser (40%):**
- Search input: "Search tables or columns..."
- Tree component (virtualized for large schemas):
  - Level 1: Schema name (collapsible, folder icon).
  - Level 2: Table name (collapsible, table icon).
  - Level 3: Column name (leaf node, column icon).
  - Each level has a tri-state checkbox: checked (all children granted) / indeterminate (some granted) / unchecked (none granted).
  - Checking a table checks all its columns by default; individual columns can be unchecked.
  - Checking a schema checks all tables.
  - Color coding: granted nodes have a `color-semantic-success` checkmark; unchecked are `color-neutral-300`.

**Right panel — Detail view (60%):**
- Shows details for the node selected in the tree.
- Table node selected: table name, schema, column list with individual read toggles (toggle switch component), column data type shown as secondary label.
- Schema node selected: summary of granted tables count / total tables count.
- Column node selected: column name, data type, parent table path, single "Read access" toggle.
- "Grant all" / "Revoke all" secondary action buttons at the panel header level for the selected scope.

**Save behavior:**
- "Save changes" sends all staged changes as a batch. Shows loading state on button.
- On success: toast "Permissions saved." + breadcrumb navigates back to S4.
- On error: inline error message below the header; staged changes preserved.

**FR coverage:** FR-AC-3.
