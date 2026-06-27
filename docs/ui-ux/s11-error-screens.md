# S11: Error / 404 / Tenant Boundary

**Purpose:** Handle forbidden access, not-found routes, and tenant-context errors.
**Layout:** Centered on `color-primary-50` background.
**Variants:**
- 404 Not Found: "This page doesn't exist." + "Return to chat" button.
- 403 Forbidden: "You don't have permission to view this page." + "Return to chat".
- Tenant boundary error: "You are not authorized to access this workspace." + "Sign out" button.
- Session expired: "Your session has expired. Please sign in again." + "Sign in" button.
**FR coverage:** NFR-MT-1, NFR-SEC-5.
