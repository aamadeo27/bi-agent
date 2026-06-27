# Screen Inventory

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
