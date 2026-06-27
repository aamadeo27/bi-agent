# S6: Admin — User Management

**Purpose:** View users in the tenant and assign roles.
**Layout:** Table (same admin sidebar as S4).
**User list columns:** Name | Email | Role | Status (active/invited/suspended) | Actions.
**Actions per row:** "Edit role" (opens inline role selector dropdown + save), "Suspend" / "Reinstate", (Invite — placeholder pending GAP-3).
**Invite flow placeholder:** "Invite user" button visible but labeled "(Coming soon)" or shown with a tooltip "Invite via email — configuration required" until GAP-3 is resolved. This avoids a dead-end screen while signaling the intent.
**Role assignment:** Dropdown showing all roles in the tenant + "No role" option; save inline.
**GAP-17 note:** Permission change mid-session behavior is unresolved. Design shows a warning banner when saving role changes: "Changes will take effect on the user's next login or session refresh." This is a safe default assumption — flagged for confirmation.
**FR coverage:** FR-AC-7.
