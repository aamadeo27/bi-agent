# Component Breakdown: Chat Workspace

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
