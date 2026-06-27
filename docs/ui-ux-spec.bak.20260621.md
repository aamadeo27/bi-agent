# UI/UX Specification: BI Result Presenter Webapp

> Version: 1.0 — Greenfield design
> Author: gf_ui-ux-designer
> Date: 2026-06-14
> Based on: `docs/requirements.md` (v1 Draft) + locked user decisions as of 2026-06-14
> Status: Ready for Architect review; gaps flagged in Section 10.

---

## Table of Contents

1. Color Palette & Design Tokens
2. Typography Scale
3. Spacing System
4. Screen Inventory
5. Navigation Map
6. Primary Flows
7. Per-Screen Specifications
8. Component Breakdown: Chat Workspace
9. Auto Chart-Type Selection UX
10. Accessibility
11. Empty / Loading / Error / Large-Result States
12. Gaps Flagged

---

## 1. Color Palette & Design Tokens

### Rationale

The product serves non-technical customers (clarity over density), business analysts (trust and precision cues), and admins (structured, table-heavy UIs). The palette is calm, professional, and high-contrast — a deep navy primary with a teal accent communicates reliability and intelligence without the sterile coldness of a pure gray-blue enterprise palette. Categorical chart colors are chosen for WCAG 2.1 AA contrast on white and against each other, and are also distinguishable for the most common form of color-vision deficiency (deuteranopia).

### Base Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `color-primary-900` | `#0F1C35` | Page backgrounds (dark mode), sidebar fill |
| `color-primary-800` | `#172A4E` | Nav bar, admin sidebar |
| `color-primary-700` | `#1E3A6E` | Button fills, active nav items |
| `color-primary-600` | `#2554A0` | Hover states on primary buttons |
| `color-primary-500` | `#3B72CC` | Primary interactive color (links, focus rings) |
| `color-primary-200` | `#C2D5F5` | Primary tints, selected row highlight |
| `color-primary-50`  | `#EEF4FD` | Page background (light mode) |
| `color-accent-500`  | `#0EA5A0` | Accent / highlight (streaming indicator, active toggle) |
| `color-accent-400`  | `#14C4BE` | Accent hover |
| `color-accent-100`  | `#D0F5F4` | Accent tint (permission badge backgrounds) |
| `color-neutral-900` | `#111827` | Body text |
| `color-neutral-700` | `#374151` | Secondary text, labels |
| `color-neutral-500` | `#6B7280` | Placeholder text, muted labels |
| `color-neutral-300` | `#D1D5DB` | Dividers, input borders |
| `color-neutral-100` | `#F3F4F6` | Card backgrounds, table row alternates |
| `color-neutral-50`  | `#F9FAFB` | Page background alt |
| `color-white`       | `#FFFFFF` | Card surfaces, chat bubbles |
| `color-semantic-success` | `#16A34A` | Success states, permission granted |
| `color-semantic-warning` | `#D97706` | Warning states, partial match |
| `color-semantic-error`   | `#DC2626` | Error states, permission denied, blocked queries |
| `color-semantic-info`    | `#2563EB` | Informational banners |

### Chart Categorical Palette (8 series)

Ordered for maximum perceptual separation; first 4 are safe for deuteranopia.

| Token | Hex | Name |
|-------|-----|------|
| `chart-cat-1` | `#3B72CC` | Primary Blue |
| `chart-cat-2` | `#E07B39` | Orange |
| `chart-cat-3` | `#0EA5A0` | Teal |
| `chart-cat-4` | `#B447B2` | Purple |
| `chart-cat-5` | `#E8C832` | Yellow |
| `chart-cat-6` | `#D94F4F` | Red |
| `chart-cat-7` | `#5DB76E` | Green |
| `chart-cat-8` | `#7B61A8` | Violet |

### Chart Sequential Palette (single-hue ramp for intensity encoding)

Ramp from `#C2D5F5` (low) → `#0F1C35` (high), 7 steps. Used for single-series heatmap-style tables or gradient bars.

### WCAG 2.1 AA Intent

- All body text (`color-neutral-900` on `color-white`): contrast ratio 16:1 — passes AA large and small.
- Primary button text (`color-white` on `color-primary-700`): contrast ratio 7.2:1 — passes AA.
- Muted labels (`color-neutral-500` on `color-white`): contrast ratio 4.6:1 — passes AA for normal text.
- Semantic error red on white: 5.8:1 — passes AA.
- Focus rings: 3px solid `color-primary-500` offset 2px — exceeds WCAG 2.1 Focus Appearance (enhanced).

---

## 2. Typography Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `text-display` | 28px / 1.75rem | 700 | 1.2 | Page headers (admin section titles) |
| `text-heading-1` | 22px / 1.375rem | 600 | 1.3 | Section headers |
| `text-heading-2` | 18px / 1.125rem | 600 | 1.4 | Card headers, drawer titles |
| `text-heading-3` | 15px / 0.9375rem | 600 | 1.4 | Table column headers, sub-labels |
| `text-body-lg` | 16px / 1rem | 400 | 1.6 | Chat messages, primary body |
| `text-body` | 14px / 0.875rem | 400 | 1.6 | UI labels, table cells |
| `text-body-sm` | 13px / 0.8125rem | 400 | 1.5 | Helper text, captions, tooltips |
| `text-mono` | 13px / 0.8125rem | 400 | 1.6 | SQL query display, code blocks (monospace font) |
| `text-label` | 11px / 0.6875rem | 600 | 1.4 | ALL-CAPS badge labels, column tags |

Font family stack: `"Inter", "Segoe UI", system-ui, sans-serif` for UI; `"JetBrains Mono", "Fira Code", "Consolas", monospace` for code.

---

## 3. Spacing System

4px base grid. Standard increments: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px.

| Token | Value | Typical usage |
|-------|-------|---------------|
| `space-1` | 4px | Icon padding, tight gaps |
| `space-2` | 8px | Inline element gaps, chip padding |
| `space-3` | 12px | Input padding, small card padding |
| `space-4` | 16px | Standard section gap |
| `space-5` | 20px | Card padding |
| `space-6` | 24px | Section gap |
| `space-8` | 32px | Large section separation |
| `space-10` | 40px | Page-level margins |

Border radius tokens: `radius-sm` 4px, `radius-md` 8px, `radius-lg` 12px, `radius-xl` 16px, `radius-full` 9999px (chips, badges).

---

## 4. Screen Inventory

| # | Screen Name | Role(s) | FR / NFR Coverage |
|---|-------------|---------|-------------------|
| S1 | Login / Auth | All | NFR-SEC-5, NFR-MT-1 |
| S2 | Chat Workspace | External Customer, Analyst | FR-UI-1, FR-UI-2, FR-UI-3, FR-LLM-1..5, FR-VIZ-1..6 |
| S3 | Query Inspect Drawer | Analyst (+ possibly Customer — see GAP-1) | FR-LLM-5, NFR-AUD-1 |
| S4 | Admin: Role Management | Admin | FR-AC-1, FR-AC-2 |
| S5 | Admin: Permission Editor | Admin | FR-AC-3, FR-AC-7 |
| S6 | Admin: User Management | Admin | FR-AC-7 |
| S7 | Admin: Data Sources | Admin | FR-LLM-1, NFR-SEC-1 (implied GAP-16) |
| S8 | Admin: Audit Log | Admin | NFR-AUD-2 (P1) |
| S9 | Partial-Permission Block (inline) | All | FR-LLM-3, FR-AC-5, GAP-12 resolved |
| S10 | Account / Profile | All | NFR-SEC-5 |
| S11 | Error / 404 / Tenant boundary | All | NFR-MT-1 |

Notes:
- S3 (Query Inspect) is a drawer/panel that overlays S2, not a separate route; it appears inline within the chat context.
- S9 (Partial-Permission Block) is a message-level state within S2, not a standalone screen.
- S8 (Audit Log) is P1; include in design but mark as P1 in implementation.
- S11 covers tenant-mismatch / forbidden / not-found error pages.

---

## 5. Navigation Map

```
[S1: Login]
    |
    v
[S2: Chat Workspace]  <------- primary destination for all roles
    |-- message input area (bottom)
    |-- message timeline (scrollable)
    |   |-- text response (streamed)
    |   |-- chart card (inline)
    |   |   |-- toggle: chart <-> table (Action B)
    |   |   |-- export menu (Action C)
    |   |   |-- "View query" button --> [S3: Query Inspect Drawer] (Action D)
    |   |-- clarification prompt message
    |   |-- [S9: Permission block message]
    |-- top nav bar
        |-- tenant name / logo
        |-- conversation list / new chat button
        |-- user menu --> [S10: Account / Profile]
        |-- (Admin only) "Admin" nav link --> [S4: Admin Hub]

[S4: Admin: Role Management]
    |-- create role --> modal (inline)
    |-- edit role --> modal (inline)
    |-- delete role --> confirm modal
    |-- click role --> [S5: Admin: Permission Editor]

[S5: Admin: Permission Editor]
    |-- schema browser (tree: schema > table > columns)
    |-- grant/revoke per node
    |-- back --> [S4]

[S6: Admin: User Management]
    |-- list users
    |-- assign role to user (inline)
    |-- (invite flow — GAP-3 unresolved; placeholder exists)

[S7: Admin: Data Sources]
    |-- list connections
    |-- add / edit / test connection (modal)

[S8: Admin: Audit Log]
    |-- filter + paginated event table
    |-- click row: event detail panel

[S10: Account / Profile]
    |-- display name, email (read-only or editable — GAP-3)
    |-- password change (only if email+password auth — GAP-7)
    |-- active role display (read-only for non-admin)

[S11: Error / 404]
    |-- "Go back" / "Return to chat" CTA
```

Admin navigation is a secondary sidebar visible only when within the `/admin` sub-route. Non-admin users never see the admin link in the top nav.

---

## 6. Primary Flows

### Flow 1: Ask a question and receive a streamed chart response

Satisfies: FR-UI-1, FR-UI-2, FR-LLM-1..4, FR-VIZ-1..4, Action A.

```
Step 1  User types a natural-language question in the chat input bar (bottom of S2).
        Input: text area with send button + keyboard shortcut (Enter to send, Shift+Enter for new line).

Step 2  Message appears immediately in the timeline (right-aligned user bubble).
        System response row appears (left-aligned) showing a skeleton loader / streaming indicator
        (animated pulse dots + "Thinking..." label with accent-color spinner).

Step 3  Text response streams token-by-token into the system message bubble.
        The bubble expands as text fills in; user can scroll the history while streaming continues.

Step 4  When the LLM output includes chart data, the chart card appears below the text
        (same message row), initially in loading state (skeleton placeholder of chart dimensions).

Step 5  Chart renders: auto-selected type (bar / line / pie / table) is shown.
        Chart type badge ("Bar chart" / "Line chart" / etc.) appears top-left of the card — passive label, not a control.
        Chart↔Table toggle appears top-right of the card (see Component: ChartCard, Section 8).

Step 6  The input bar re-enables; user can ask a follow-up.
```

### Flow 2: Follow-up question

Satisfies: FR-UI-2, FR-UI-3, Action E.

```
Step 1  User types a follow-up (e.g. "filter that by region X") and submits.

Step 2  Identical to Flow 1 steps 2–6.
        The previous chart card remains visible above the new one in the timeline.
        Each message preserves its own independent toggle state and export menu.

Step 3  If context resolution fails (agent cannot resolve "that" or "previous result"),
        a clarification message appears (see State: Clarification, Section 11).
```

### Flow 3: Chart ↔ Table toggle

Satisfies: FR-VIZ-3, NFR-A11Y-1, Action B.

```
Step 1  User clicks the toggle button (labeled "Table view" when chart is shown; "Chart view"
        when table is shown) on a specific chart card in the timeline.

Step 2  The card transitions (100ms fade + resize) to the alternate view.
        Toggle button label and icon update immediately.
        State is remembered for that specific message for the duration of the session.
        (GAP-13 assumption: toggle uses the already-fetched result set in client memory;
        no new query is issued. This assumption is logged as a design decision pending
        Architect confirmation.)

Step 3  Table view shows: sortable column headers (click to sort asc/desc, indicator arrow),
        paginated rows (page size 20 by default with page selector), column widths auto-sized.

Step 4  User can toggle back at any time. No data is re-fetched.
```

### Flow 4: Export a result

Satisfies: FR-VIZ-6, Action C.

```
Step 1  User clicks the "Export" button (download icon + label) on a chart card.
        A small popover/dropdown appears with four options:
          - "Chart as PNG"
          - "Chart as JPEG"
          - "Data as CSV"
          - "Data as JSON"

Step 2a (Image export) The chart component is rendered to a canvas and the image file is
        triggered as a browser download. Filename: "[question-slug]-[timestamp].png".
        (GAP-14 assumption: client-side image generation for chart exports.
        Server-side generation logged as a gap — see Section 10.)

Step 2b (Data export) The result set (as already fetched) is serialized to CSV or JSON
        and triggered as a browser download. Filename: "[question-slug]-[timestamp].csv".
        (GAP-14 assumption: client-side serialization for data export; size limit TBD.
        For large results, show a warning if row count exceeds a threshold — exact number
        is a GAP-14 gap.)

Step 3  A transient toast notification confirms: "Exported as [filename]" (3-second auto-dismiss).
```

### Flow 5: Inspect the generated query (audit)

Satisfies: FR-LLM-5, NFR-AUD-1, Action D.

```
Step 1  A "View query" link/button (small, secondary, below each system response) is
        visible to users with query-inspect rights (GAP-1 assumption: visible to Analyst
        and Admin roles; hidden from External Customer — stated assumption, not guessed default).

Step 2  User clicks "View query". The Query Inspect Drawer (S3) slides in from the right,
        covering ~40% of the viewport without hiding the timeline.

Step 3  The drawer shows:
          - Header: "Generated query" + close (X) button.
          - Source label: "SQL" or "REST" badge.
          - Read-only code block (monospace, syntax-highlighted, line-numbered).
          - "Copy" button (clipboard icon).
          - Execution metadata: data source name, timestamp, row count returned.

Step 4  User clicks X or presses Escape; drawer closes with a slide-out transition.
        The timeline is not affected.
```

### Flow 6: Partial-permission block + explanation

Satisfies: FR-LLM-3, FR-AC-5, GAP-12 (resolved: block + explain), Action A edge case.

```
Step 1  User submits a question that references tables/columns outside their role.

Step 2  The system message bubble appears in the timeline (no chart, no table).
        The bubble has a distinct visual treatment:
          - Left border: 4px solid `color-semantic-error`.
          - Icon: shield-with-x icon in `color-semantic-error`.
          - Heading: "Access restricted" (text-heading-2, color-semantic-error).

Step 3  Body text (text-body-lg, color-neutral-700) explains in plain language:
        "Your current role ([role name]) does not have access to the following
        resources required to answer this question:"

Step 4  A structured list follows:
          - Table name: `schema.table_name` — "Access needed: read"
          - Column: `table.column_name` — "Access needed: read"
          (Each item has a small lock icon and uses text-mono for identifiers.)

Step 5  Below the list, a suggestion line: "Contact your administrator to request access,
        or try rephrasing your question to use data you have access to."

Step 6  The input bar remains active. User can ask a different question.
        No query was executed; no data was exposed.
```

### Flow 7: Admin — create a role and assign permissions

Satisfies: FR-AC-1, FR-AC-2, FR-AC-3, FR-AC-7, Action F.

```
Step 1  Admin navigates to Admin > Roles (S4) via the top nav admin link.
        Left sidebar shows: Roles | Users | Data Sources | Audit Log.

Step 2  Admin clicks "New role" (primary button, top-right of S4).
        An inline modal opens:
          - Role name input (required, max 64 chars, unique within tenant).
          - Description textarea (optional, max 256 chars).
          - "Create role" button / "Cancel" button.

Step 3  Role is created and appears in the roles list (card or table row).
        A success toast: "Role '[name]' created."

Step 4  Admin clicks the role row / "Edit permissions" button.
        Navigates to S5: Permission Editor for that role.

Step 5  Permission Editor (S5) layout:
          Left panel (40%): Schema browser tree.
            - Tree nodes: Schema > Tables > Columns.
            - Each node has a checkbox (tri-state: all granted, some granted, none).
            - Expand/collapse chevrons.
            - Search/filter input above the tree.
          Right panel (60%): Detail view for selected node.
            - Shows the selected table or column with its full path.
            - Toggle: "Read access" (on/off; the only access type in v1).
            - For table nodes: a sub-list of columns with individual toggles.

Step 6  Admin checks/unchecks nodes. Changes are staged (shown as unsaved in the header
        "Unsaved changes" badge) and committed with a "Save changes" button.
        Cancel discards staged changes (with confirmation dialog if changes exist).

Step 7  Success toast: "Permissions updated for '[role name]'."

Step 8  Admin navigates to Admin > Users (S6) to assign the role.
        Finds the user row (searchable list), clicks "Edit", selects the role from a
        dropdown (single role per user in v1 — GAP-3 assumption; see Section 10),
        saves. Success toast: "Role assigned to [user name]."
```

### Flow 8: Admin — manage data sources

Satisfies: implied by FR-LLM-1, NFR-SEC-1, Action F edge note.

```
Step 1  Admin navigates to Admin > Data Sources (S7).

Step 2  List of existing connections: name, type (SQL dialect / REST), status (connected /
        error / unconfigured), last tested timestamp.

Step 3  "Add data source" modal:
          - Name (required).
          - Type selector: SQL database / REST API.
          - Connection details (host, port, database name, credentials) — masked.
          - Test connection button (inline validation before save).
          - Save / Cancel.

Step 4  Test connection shows inline result: green checkmark "Connected" or red X
        "Connection failed: [error message]".

Step 5  Existing connections: edit (pencil icon), delete (trash icon with confirm modal),
        re-test (lightning icon).

Note: Data source management is designed for Admin; GAP-16 (whether tenant admin vs.
platform manages this) is flagged. This screen is included but marked as pending
confirmation on ownership model.
```

---

## 7. Per-Screen Specifications

### S1: Login / Auth

**Purpose:** Authenticate users before any access.
**Layout:** Centered card on a `color-primary-800` full-page background.
**Components:**
- Product logo + wordmark (top of card).
- Tenant name or subdomain context (if resolvable from URL — e.g. `tenant.app.com`).
- Auth form fields (email, password — or SSO button if applicable; GAP-7 unresolved, both placeholders are included).
- "Sign in" primary button.
- "Forgot password?" link (if email+password auth).
- Error state: inline form-level error message in `color-semantic-error` below the button.
**States:** idle, loading (button spinner + disabled), error.
**FR coverage:** NFR-SEC-5, NFR-MT-1.

---

### S2: Chat Workspace

**Purpose:** Primary interface for all users — ask questions, see streamed responses, interact with charts.
**Layout:** Three-column layout (collapsed on mobile — mobile is out of scope for v1 unless confirmed):
- Left sidebar (240px, collapsible): Conversation list.
- Center content area (flex, fills remaining width): Chat timeline + input bar.
- Right: Query Inspect Drawer (S3) slides in on demand.

**Left Sidebar:**
- Tenant logo / name (top).
- "New conversation" button (primary, full-width at top of sidebar).
- Scrollable list of past conversations: title (truncated at 40 chars, derived from first user message), relative timestamp ("2 hours ago"), hover shows delete option.
- Active conversation is highlighted (`color-primary-200` background).

**Top Nav Bar (full width, above center):**
- Left: hamburger/toggle for sidebar on small viewports.
- Center: current conversation title (editable on double-click).
- Right: Admin nav link (Admin role only) | User menu (avatar + name, dropdown: Profile, Sign out).

**Chat Timeline (center, scrollable, bottom-anchored):**
- User messages: right-aligned bubble, `color-primary-200` fill, `color-neutral-900` text.
- System messages: left-aligned, `color-white` card with `color-neutral-300` border, `color-neutral-900` text.
- Timestamps: `text-body-sm`, `color-neutral-500`, shown on hover.
- Auto-scrolls to bottom on new message; user can scroll up without interruption; "Scroll to bottom" FAB appears if user has scrolled up while streaming.

**Input Bar (bottom, sticky):**
- Full-width text area (auto-expanding, max 6 lines before scroll).
- Placeholder: "Ask a question about your data..."
- Send button (icon + label "Send") enabled only when text is non-empty.
- Keyboard: Enter sends; Shift+Enter inserts newline.
- Disabled state while a response is streaming (send button grayed; text input accepts typing but queuing behavior is a GAP — see Section 10).
- Character limit: not enforced in UI (soft server limit, return error if exceeded — exact limit is GAP-8).

**FR coverage:** FR-UI-1, FR-UI-2, FR-LLM-4, FR-VIZ-4.

---

### S3: Query Inspect Drawer

**Purpose:** Display the raw SQL or REST query generated by the LLM for a specific response.
**Layout:** Right-side drawer, 40vw wide, slides over the chat workspace without hiding the timeline.
**Trigger:** "View query" button on a system message (visible per GAP-1 assumption: Analyst + Admin roles only).
**Components:**
- Header: "Generated query" label, close button (X).
- Metadata strip: data source name | query type badge (SQL / REST) | executed at [timestamp] | [N] rows returned.
- Code block: monospace font (`text-mono`), syntax-highlighted (SQL or JSON), line-numbered, vertically scrollable.
- "Copy to clipboard" button (top-right of code block), shows "Copied!" label for 2s on click.
- Footer: link "Learn more about how queries are generated" (optional help link — placeholder).
**States:** loading (skeleton of code block), populated, error (if query metadata unavailable: "Query details not available").
**FR coverage:** FR-LLM-5, NFR-AUD-1.

---

### S4: Admin — Role Management

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

---

### S5: Admin — Permission Editor

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

---

### S6: Admin — User Management

**Purpose:** View users in the tenant and assign roles.
**Layout:** Table (same admin sidebar as S4).
**User list columns:** Name | Email | Role | Status (active/invited/suspended) | Actions.
**Actions per row:** "Edit role" (opens inline role selector dropdown + save), "Suspend" / "Reinstate", (Invite — placeholder pending GAP-3).
**Invite flow placeholder:** "Invite user" button visible but labeled "(Coming soon)" or shown with a tooltip "Invite via email — configuration required" until GAP-3 is resolved. This avoids a dead-end screen while signaling the intent.
**Role assignment:** Dropdown showing all roles in the tenant + "No role" option; save inline.
**GAP-17 note:** Permission change mid-session behavior is unresolved. Design shows a warning banner when saving role changes: "Changes will take effect on the user's next login or session refresh." This is a safe default assumption — flagged for confirmation.
**FR coverage:** FR-AC-7.

---

### S7: Admin — Data Sources

**Purpose:** Configure and test data source connections used by the LLM agent.
**Layout:** Card grid or table (same admin sidebar).
**Connection card:** Name | Type badge | Status indicator (green dot / red dot / gray dot) | Last tested timestamp | Actions (Edit, Delete, Test).
**Add / Edit modal:**
- Name (required).
- Type: dropdown (PostgreSQL / MySQL / MSSQL / BigQuery / REST API — exact list is GAP-16).
- Connection string or individual fields (host, port, db, username, password — masked by default, reveal toggle).
- "Test connection" button: shows inline spinner → "Connected [timestamp]" or "Failed: [error]".
- Save / Cancel.
**Delete confirm:** standard destructive modal.
**FR coverage:** Implied by FR-LLM-1, NFR-SEC-1 (infra credential binding is an Architect concern; UI shows connection name only, not credentials in display).

---

### S8: Admin — Audit Log (P1)

**Purpose:** Review security-relevant events (query executions, permission decisions, exports, role changes).
**Layout:** Full-width table with filter bar (same admin sidebar).
**Filter bar:** date range picker | event type multi-select | user search | data source filter.
**Table columns:** Timestamp | User | Event type | Description (truncated) | Data source | Status (success/blocked/error).
**Row expansion / detail panel:** Click a row to open a detail panel below (accordion) or a right-side drawer showing full event metadata (query text if applicable, role at time of event, IP, outcome).
**Pagination:** 50 rows per page with page controls.
**Export table button:** Export filtered log as CSV.
**Empty state:** "No events match your filters." or "Audit logging will appear here as users interact with the system."
**FR coverage:** NFR-AUD-2.

---

### S9: Partial-Permission Block (inline state within S2)

Fully described in Flow 6 above. This is a message state, not a standalone screen.

---

### S10: Account / Profile

**Purpose:** User views and optionally updates their profile.
**Layout:** Settings-style page with simple form.
**Fields:** Display name (editable) | Email (read-only) | Active role (read-only, shows role name) | Tenant name (read-only).
**Change password section:** Only shown if email+password auth (GAP-7). Two-field form: new password + confirm; save button.
**Danger zone (for admins of their own account):** Sign out of all sessions.
**FR coverage:** NFR-SEC-5.

---

### S11: Error / 404 / Tenant Boundary

**Purpose:** Handle forbidden access, not-found routes, and tenant-context errors.
**Layout:** Centered on `color-primary-50` background.
**Variants:**
- 404 Not Found: "This page doesn't exist." + "Return to chat" button.
- 403 Forbidden: "You don't have permission to view this page." + "Return to chat".
- Tenant boundary error: "You are not authorized to access this workspace." + "Sign out" button.
- Session expired: "Your session has expired. Please sign in again." + "Sign in" button.
**FR coverage:** NFR-MT-1, NFR-SEC-5.

---

## 8. Component Breakdown: Chat Workspace

### Component: MessageBubble (user)

- Container: right-aligned flex row, max-width 70% of timeline width.
- Background: `color-primary-200`, border-radius `radius-lg`.
- Text: `text-body-lg`, `color-neutral-900`.
- Padding: `space-3` vertical, `space-4` horizontal.
- Timestamp: `text-body-sm`, `color-neutral-500`, hidden until hover on the bubble row.
- No avatar shown (space efficiency; user knows they sent it).

---

### Component: SystemMessageBubble

- Container: left-aligned flex row, max-width 85% of timeline width.
- Background: `color-white`, border: 1px solid `color-neutral-300`, border-radius `radius-lg`.
- Bot avatar: small `color-primary-700` circle with initials "BI" or product icon, left of bubble.
- Text content area: `text-body-lg`, `color-neutral-900`, supports markdown rendering (bold, lists, inline code).
- Streaming cursor: animated blinking bar `|` shown at the text insertion point while streaming.
- Below the text content (when data is available): ChartCard component.
- Below the chart card (when applicable): "View query" secondary text button (Analyst/Admin only).

---

### Component: StreamingIndicator

Shown during the window between question submission and the first token arriving:
- Left-aligned, same position as a SystemMessageBubble.
- Three animated dots (pulse animation, `color-accent-500`).
- Text: "Thinking..." in `text-body-sm`, `color-neutral-500`.
- Replaces itself with the SystemMessageBubble once the first token arrives.

---

### Component: ChartCard

**Container:**
- Background: `color-white`, border: 1px solid `color-neutral-300`, border-radius `radius-lg`.
- Padding: `space-5` all sides.
- Shadow: `0 1px 4px rgba(0,0,0,0.08)` (subtle depth, distinguishes card from bubble).
- Max-width: 100% of the system bubble container.
- Min-height: 280px (chart placeholder).

**Header row (inside card, single flex row):**
- Left: chart type badge — small pill, `color-neutral-100` background, `color-neutral-700` text, `text-label` style. Content: "Bar chart" / "Line chart" / "Pie chart" / "Table". No interactive control (display only; manual chart-type switching is out of scope per v1 locked decisions).
- Right: two controls in a button group:
  - Toggle button: "Table view" (icon: table grid icon) when chart is visible; "Chart view" (icon: bar-chart icon) when table is visible.
  - Export button: download icon + "Export" label; click opens export popover.

**Chart area:**
- Renders the appropriate chart component (bar, line, pie, or table).
- Charts are responsive to card width.
- Tooltip on hover (FR-VIZ-5): appears on bar hover, line point hover, pie slice hover. Tooltip shows: series name, dimension label, exact numeric value with formatting (comma separators, up to 2 decimal places).
- Charts use the categorical palette defined in Section 1 (chart-cat-1 through chart-cat-8, cycling if more series).

**Table area (when toggled or auto-selected as type):**
- Column headers: `text-heading-3`, sortable (click to toggle asc/desc; triangle indicator).
- Column widths: auto, min 80px.
- Rows: alternate `color-neutral-100` and `color-white` for readability.
- Pagination bar: row count label ("Showing 1–20 of 143 results") + prev/next buttons + page selector.
- Default page size: 20 rows; selector: 20 / 50 / 100.

**Loading state:**
- Card renders with correct dimensions; chart area shows a skeleton gradient animation.

**Empty result state:**
- Chart area replaced by: empty-state illustration (simple icon) + "No data returned for this query." text (`text-body`, `color-neutral-500`).

**Large result warning:**
- If row count exceeds threshold (exact threshold is GAP-14 / GAP-8), show an info banner inside the card: "This result has [N] rows. The chart shows a summary; export the full data as CSV or JSON." The chart still renders a representative sample or aggregate.

---

### Component: ExportPopover

- Small dropdown popover (4 menu items) anchored to the Export button.
- Items: "Chart as PNG" (icon: image icon) | "Chart as JPEG" | "Data as CSV" (icon: table icon) | "Data as JSON".
- Each item has a hover state (`color-neutral-100` background).
- Closes on selection or click-outside.
- After selection: loading toast "Preparing export..." followed by "Exported as [filename]."

---

### Component: QueryInspectButton

- Small secondary text button below the SystemMessageBubble, aligned left.
- Label: "View query" with a code/inspect icon.
- Only rendered for users in Analyst or Admin roles (GAP-1 assumption — flagged).
- Click opens S3 (Query Inspect Drawer).

---

### Component: PermissionBlockMessage

Described fully in Flow 6. Key structural elements:
- Special variant of SystemMessageBubble with `color-semantic-error` left border (4px solid).
- Icon: lock/shield icon in `color-semantic-error`.
- Heading: "Access restricted" (`text-heading-2`, `color-semantic-error`).
- Body paragraph: plain-language explanation.
- Blocked-resource list: monospace identifiers with lock icons.
- Footer suggestion: plain text.

---

### Component: ClarificationMessage

Shown when the LLM cannot interpret the query (FR-LLM-3):
- Variant of SystemMessageBubble with `color-semantic-warning` left border (4px solid).
- Icon: question-mark circle in `color-semantic-warning`.
- Heading: "I need more information" (`text-heading-2`, `color-neutral-900`).
- Body: the LLM's clarification request (streamed text).
- The user responds in the chat input as normal.

---

### Component: AdminSidebar

- Fixed-width left sidebar (160px) within the `/admin` route.
- Links: Roles | Users | Data Sources | Audit Log.
- Active link: `color-primary-200` background, `color-primary-700` text, left border `4px solid color-primary-700`.
- Inactive: `color-neutral-700` text, no background.
- Bottom: "Back to chat" link with chat-bubble icon.

---

## 9. Auto Chart-Type Selection UX

### Selection Logic (design-level rules — fulfills GAP-19 with stated assumptions)

The backend determines chart type based on result shape. The UI communicates the selection transparently and provides the table toggle as an escape hatch. Manual chart-type switching is out of scope for v1.

Assumed selection mapping (to be confirmed and implemented by Architect/coder):

| Data shape | Auto-selected chart type | Rationale |
|------------|--------------------------|-----------|
| 1 dimension (categorical / ordinal) + 1 numeric measure | Bar chart | Comparison of discrete categories |
| 1 time dimension + 1 or more numeric measures | Line chart | Trends over time |
| 1 dimension (3–8 distinct values) + 1 numeric measure summing to a whole | Pie / Donut chart | Part-of-whole proportions; cardinality limit enforced |
| 1 dimension (>8 distinct values) + 1 numeric measure | Bar chart | Pie not appropriate at high cardinality |
| 2+ dimensions or mixed types where no clear chart maps | Data Table | Raw exploration; always correct fallback |
| Result has 0 rows | Data Table (empty) | Empty state; chart would be meaningless |
| Result has >2000 rows (threshold — GAP-8 pending) | Data Table with pagination | Chart rendering would be illegible/slow |

### How the UX communicates chart selection

1. The chart type badge (top-left of ChartCard) shows the auto-selected type as a read-only label. Users are informed without being given a control that is out of scope.
2. The chart renders immediately; there is no "selecting chart..." intermediate state.
3. If the selection logic falls back to Data Table, the badge reads "Table" and no toggle is shown (chart and table are the same view). The toggle only appears when a chart was actually rendered.
4. The chart renders with the chart-cat palette; series order follows the result set column order.
5. No override control is exposed in v1. Future work (manual chart manipulation) can add a "Change chart type" button in the same header row without breaking the layout.

### Chart ↔ Table Toggle Affordance

- Toggle button is always visible on ChartCards where a chart (not table) was auto-selected.
- When in table view, toggle shows "Chart view" to return.
- The toggle is a labeled button with an icon — never an icon-only control — to ensure discoverability and accessibility.
- Current view mode is also reflected in the `aria-pressed` state of the toggle button.

---

## 10. Accessibility

### Chart ↔ Table Toggle as Accessible Fallback (NFR-A11Y-1)

The requirements explicitly identify the chart/table toggle (FR-VIZ-3) as the accessibility mechanism for chart content. Design implementation:

1. Every chart in the chat workspace is accompanied by a visible, labeled toggle button ("Table view"). Screen reader users can reach this button in the natural tab order.
2. When in table view, the data is fully accessible as a standard HTML table with proper `<thead>`, `<th scope="col">`, `<caption>`, and ARIA roles.
3. Chart SVG elements include `role="img"` and `aria-label` describing the chart title and data summary (e.g., "Bar chart: monthly revenue by region, January through June. 6 data points. Use the Table view button to see the full data.").
4. Pie/donut chart slices include `aria-label` per slice: "[Label]: [value] ([percentage]%)".
5. Tooltips on hover are also triggered on keyboard focus of individual chart elements (where the charting library supports it).

### General Accessibility Commitments

- All interactive controls: keyboard focusable, visible focus indicator (3px solid `color-primary-500`, 2px offset).
- All form fields: explicit `<label>` associations (not placeholder-only).
- All icon-only buttons: `aria-label` (none used in this design — all buttons have visible labels).
- Modals: focus trapped inside while open; `aria-modal="true"`; Escape closes.
- Drawers: same focus management as modals.
- Toasts: announced via `aria-live="polite"` region.
- Error messages: associated with form fields via `aria-describedby`.
- Admin tree (S5): standard tree ARIA pattern (`role="tree"`, `role="treeitem"`, keyboard: arrow keys expand/collapse, space toggles checkbox).
- Color is never the sole differentiator: status indicators combine color + icon + text label.

---

## 11. Empty / Loading / Error / Large-Result States

### Loading States

| Context | Treatment |
|---------|-----------|
| Initial page load | Full-screen spinner on `color-primary-50`, centered, accent-colored. |
| Streaming response | StreamingIndicator component (three animated dots) while awaiting first token; then inline streaming cursor in the message bubble. |
| Chart rendering | ChartCard with skeleton gradient placeholder (same card dimensions). |
| Toggle (chart ↔ table) | Instant (client-side data, no async); no loader needed per GAP-13 assumption. |
| Export preparing | Toast: "Preparing export..." with spinner icon. |
| Admin table/list load | Skeleton rows (3–5 shimmer rows) in place of actual data. |
| Query inspect drawer | Skeleton of the code block (full-width gray shimmer) for ~200ms. |

### Empty States

| Context | Treatment |
|---------|-----------|
| No conversations (new user) | Chat timeline shows a centered welcome illustration + "Ask your first question" text + example prompt chips (3–4 suggestion chips, e.g. "Show me sales by region", "What were the top products last month?"). |
| Empty result set | ChartCard empty state: icon + "No data returned for this query." |
| No roles (admin S4) | "No roles yet. Create your first role to get started." + "New role" button. |
| No users (admin S6) | "No users found." + Invite placeholder. |
| No data sources (admin S7) | "No data sources connected. Add a connection to enable querying." + "Add data source" button. |
| No audit log events (admin S8) | "No events match the selected filters." |
| No conversation history | Left sidebar: "No previous conversations." below the "New conversation" button. |

### Error States

| Context | Treatment |
|---------|-----------|
| LLM / query execution failure | SystemMessageBubble with `color-semantic-error` left border; heading "Something went wrong"; body describes the error in plain language; "Try again" button re-submits the same question. |
| Permission block | PermissionBlockMessage component (detailed in Flow 6 and Section 8). |
| Clarification needed | ClarificationMessage component (Section 8). |
| Network/connection error | Sticky banner below the top nav: "Connection lost. Trying to reconnect..." (yellow/warning). Resolves to "Reconnected." (green) or stays as "Unable to reconnect — refresh the page." |
| Data source unreachable | SystemMessageBubble error variant: "The data source '[name]' is currently unavailable. Please try again later or contact your administrator." |
| Auth session expired | Redirects to S1 Login with a banner: "Your session expired. Please sign in again." |
| 404 / forbidden | S11 screen variant. |
| Admin: role name conflict | Inline form error below the role-name input: "A role with this name already exists." |
| Data source connection failed | Inline in add/edit modal: "Connection failed: [error message]" in `color-semantic-error`. |
| Export failure | Toast error: "Export failed. Please try again." |

### Large-Result States

| Context | Treatment |
|---------|-----------|
| Chart with many categories (>20 visible bars/slices) | Auto-downgrades to data table (per chart-selection logic in Section 9). Info banner inside ChartCard explains: "Too many categories to chart clearly. Showing as table." |
| Large row count (threshold TBD — GAP-8/GAP-14) | ChartCard info banner: "This result has [N] rows. The chart shows a summary; use Export to get the full dataset." |
| Very large CSV/JSON export (threshold TBD — GAP-14) | Warning popover before download: "This export contains [N] rows and may be large. Continue?" with Confirm / Cancel. |

---

## 12. Gaps Flagged

The following gaps from `docs/requirements.md` affect UX design decisions. Each is either resolved with a stated assumption (marked **ASSUMED**) or escalated for user/Architect input (marked **OPEN**).

---

### GAP-1: Query Inspection Visibility (who sees "View query")

**Status: ASSUMED — escalate to confirm.**
**Design assumption:** The "View query" button (S3 / Flow 5) is shown to users in **Analyst** and **Admin** roles only. External Customer role does not see this button. This is the most conservative and security-sensible default.
**Question for requirements:** Confirm whether External Customers should or should not see the generated SQL. If some customers are technical/power users, a per-role permission flag for query inspection would be needed (adding a toggle to S5 Permission Editor).

---

### GAP-10: Accessibility Conformance Target

**Status: ASSUMED — escalate if legal/contractual basis differs.**
**Design assumption:** WCAG 2.1 Level AA throughout. Design tokens and component specs in this document are written to meet AA contrast minimums. No enhanced AAA commitments are made.
**Question for requirements:** Confirm whether any customers have contractual or regulatory accessibility requirements beyond WCAG 2.1 AA (e.g., Section 508, EN 301 549, AAA targets).

---

### GAP-13: Toggle Reuses Cached Result vs. Re-Queries

**Status: ASSUMED — escalate to Architect.**
**Design assumption:** The chart/table toggle uses the result set already held in client-side memory from the original query. No new query is issued on toggle. This is reflected in the design (no loader on toggle, instant transition).
**Question for Architect:** Confirm client-side result caching strategy and any memory constraints for large result sets. If results are not cached (e.g., for privacy/memory reasons), a loading state must be added to the toggle.

---

### GAP-14: Export Delivery Mechanism and Size Limits

**Status: PARTIALLY ASSUMED — escalate remainder.**
**Design assumption:**
- Chart image exports (PNG/JPEG): client-side canvas rendering + browser download. No server round-trip.
- Data exports (CSV/JSON): client-side serialization of the cached result + browser download.
- For very large row counts, a user-facing warning is shown before download; exact row threshold is TBD.
**Open questions:**
- Is there a maximum export size / row limit enforced server-side?
- For very large exports (e.g., millions of rows), does the server generate a file and provide a download link, or is client-side serialization always sufficient?
- What are the data retention / security requirements for server-generated export files (if any)?

---

### GAP-19: Auto Chart-Selection Rules (tie-breaking and edge cases)

**Status: ASSUMED — flagged for Architect/coder confirmation.**
**Design assumption:** See Section 9 for the full mapping table. The assumed rules cover the four v1 chart types. Edge cases assumed:
- Tie between bar and line (data has both categorical and time dimensions): prefer **line** if a time column is present.
- Pie chart only when 3–8 distinct values AND values sum to a meaningful whole.
- Data Table is the catch-all fallback for any unrecognized shape.
**Open questions:** Does the Architect / coder team accept these rules, or will different heuristics be implemented? The chart type badge in the UI reflects whatever the backend selects — the UI does not need to change if the rules change, but the badge label must match the actual rendered type.

---

### Additional OPEN Gaps (not in the GAP-1/10/13/14/19 focus list but UX-impactful)

| GAP | UX Impact | Recommendation |
|-----|-----------|----------------|
| GAP-3 (user invite/creation flow) | S6 User Management has a placeholder "Invite" that cannot be designed without knowing the auth/invite model. | Resolve GAP-7 (auth mechanism) first; then invite flow design can follow. |
| GAP-4 (conversation history retention) | S2 left sidebar shows past conversations; if history is ephemeral (session-only), the sidebar shows only the current session. If persistent, it needs pagination or date grouping. | Confirm retention policy and duration. Design accommodates both (sidebar is present; content varies). |
| GAP-7 (auth mechanism) | S1 Login screen has both email+password fields and an SSO button as placeholders. Final S1 design depends on which auth method(s) are supported. | Confirm auth mechanism so S1 can be finalized. |
| GAP-16 (data source types) | S7 Data Sources type dropdown list is a placeholder. The exact SQL dialects and REST API types determine the form fields in the add/edit modal. | Confirm supported connector types for v1. |
| GAP-17 (permission change mid-session) | S6 shows a warning "Changes take effect on next login" — this is a safe assumption but may be wrong if the system supports real-time permission invalidation. | Confirm permission change propagation model; if real-time, the warning is removed. |
| GAP-3 / single-role assumption | S6 User Management design assumes one role per user (simplest model). If multi-role assignment is needed, the UI must change to a multi-select. | Confirm role cardinality per user. |

---

*End of UI/UX Specification v1.0*
