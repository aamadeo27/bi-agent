# S1: Login / Auth

**Purpose:** Authenticate users before any access.
**Layout:** Centered card on a `color-primary-800` full-page background.
**Components:**
- Product logo + wordmark (top of card).
- Tenant name or subdomain context (if resolvable from URL — e.g. `tenant.app.com`).
- Auth form fields (email, password — or SSO button if applicable; GAP-7 unresolved, both placeholders are included).
- "Sign in" primary button.
- "Forgot password?" link (if email+password auth).
- Error state: inline form-level error message in `color-semantic-error` below the button.
**States:** idle, loading (button spinner + disabled), error.
**FR coverage:** NFR-SEC-5, NFR-MT-1.
