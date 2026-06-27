# Primary Flows

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
