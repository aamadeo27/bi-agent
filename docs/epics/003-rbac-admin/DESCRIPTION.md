# Epic 003 — RBAC & admin

Custom roles, schema/table/column resource grants, per-role capability flags
(incl. `canInspectQuery`), user↔role assignment, and the admin UI screens for all
of it.

## Motivation
Covers FR-AC-1, FR-AC-2, FR-AC-3, FR-AC-7, FR-LLM-5 (capability toggle, GAP-1
locked). UI: S4 Role Management, S5 Permission Editor, S6 User Management. Provides
the grant model the ask-pipeline gate (epic 005) and the credential proxy
(epic 004) consume.

## Definition of Done
- Admins can CRUD roles (unique name per tenant) and toggle `canInspectQuery`.
- Admins can grant/revoke read access at schema/table/column granularity via the
  tri-state editor, saved as an explicit batch.
- Admins can assign a single role to a user and suspend/reinstate users.
- All admin routes are tenant-scoped and admin-gated.

## deps: 001, 002

## Dependency graph & parallelism plan

Wave 1 (parallel): T3.1, T3.4
Wave 2 (parallel): T3.2, T3.5
Wave 3 (parallel): T3.3, T3.6

- T3.1 (role CRUD API) and T3.4 (Role Mgmt UI S4) parallel — share only contracts.
- T3.2 (grant API + schema-tree endpoint) and T3.5 (Permission Editor UI S5) parallel.
- T3.3 (user↔role API) and T3.6 (User Mgmt UI S6) parallel.
- Backend tasks (T01–T3.3) touch the rbac module; if executed by one coder, run them
  serially T01→T02→T3.3 to avoid module contention; otherwise they pair with their UI.

## Risks / open questions
- Single-role-per-user confirmed for v1 (one `roleId` per user).
- GAP-17 propagation note surfaced in S6 ("takes effect next session").
