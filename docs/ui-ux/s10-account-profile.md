# S10: Account / Profile

**Purpose:** User views and optionally updates their profile.
**Layout:** Settings-style page with simple form.
**Fields:** Display name (editable) | Email (read-only) | Active role (read-only, shows role name) | Tenant name (read-only).
**Change password section:** Only shown if email+password auth (GAP-7). Two-field form: new password + confirm; save button.
**Danger zone (for admins of their own account):** Sign out of all sessions.
**FR coverage:** NFR-SEC-5.
