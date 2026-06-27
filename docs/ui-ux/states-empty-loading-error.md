# Empty / Loading / Error / Large-Result States

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
