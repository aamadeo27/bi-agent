# UI/UX spec

One screen/section per file. Tasks `design-refs:` the slugs below; the
orchestrator inlines them verbatim (coders never read this folder).

- [Color Palette & Design Tokens](design-tokens.md) — color/chart tokens + WCAG AA intent
- [Typography Scale](typography.md) — type tokens, sizes, font stacks
- [Spacing System](spacing.md) — 4px grid, spacing + radius tokens
- [Screen Inventory](screen-inventory.md) — S1–S11 list + role/FR coverage
- [Navigation Map](navigation-map.md) — route/nav tree across screens
- [Primary Flows](primary-flows.md) — 8 end-to-end interaction flows
- [S1 — Login / Auth](s1-login-auth.md) — centered auth card, email/SSO placeholders
- [S2 — Chat Workspace](s2-chat-workspace.md) — 3-col chat: sidebar, timeline, input bar
- [S3 — Query Inspect Drawer](s3-query-inspect-drawer.md) — right drawer: generated SQL/REST + copy
- [S4 — Admin: Role Management](s4-admin-role-management.md) — role CRUD list + create/delete modals
- [S5 — Admin: Permission Editor](s5-admin-permission-editor.md) — schema tree + grant/revoke detail panel
- [S6 — Admin: User Management](s6-admin-user-management.md) — user list + inline role assignment
- [S7 — Admin: Data Sources](s7-admin-data-sources.md) — connection cards + add/test modal
- [S8 — Admin: Audit Log (P1)](s8-admin-audit-log.md) — filterable event table + detail panel
- [S9 — Partial-Permission Block](s9-partial-permission-block.md) — inline access-restricted message state
- [S10 — Account / Profile](s10-account-profile.md) — editable profile + password change
- [S11 — Error / 404 / Tenant Boundary](s11-error-screens.md) — 404/403/tenant/session-expired variants
- [Component Breakdown: Chat Workspace](components-chat-workspace.md) — MessageBubble, ChartCard, popovers, sidebar
- [Auto Chart-Type Selection UX](chart-type-selection.md) — data-shape → chart-type rules + affordance
- [Accessibility](accessibility.md) — toggle fallback + WCAG 2.1 AA commitments
- [Empty / Loading / Error / Large-Result States](states-empty-loading-error.md) — state matrices for all surfaces
- [Gaps Flagged](gaps-flagged.md) — open/assumed UX gaps from requirements
