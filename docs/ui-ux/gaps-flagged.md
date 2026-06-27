# Gaps Flagged

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
