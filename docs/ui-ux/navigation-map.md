# Navigation Map

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
