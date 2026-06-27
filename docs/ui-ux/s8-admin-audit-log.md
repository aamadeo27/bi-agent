# S8: Admin — Audit Log (P1)

**Purpose:** Review security-relevant events (query executions, permission decisions, exports, role changes).
**Layout:** Full-width table with filter bar (same admin sidebar).
**Filter bar:** date range picker | event type multi-select | user search | data source filter.
**Table columns:** Timestamp | User | Event type | Description (truncated) | Data source | Status (success/blocked/error).
**Row expansion / detail panel:** Click a row to open a detail panel below (accordion) or a right-side drawer showing full event metadata (query text if applicable, role at time of event, IP, outcome).
**Pagination:** 50 rows per page with page controls.
**Export table button:** Export filtered log as CSV.
**Empty state:** "No events match your filters." or "Audit logging will appear here as users interact with the system."
**FR coverage:** NFR-AUD-2.
