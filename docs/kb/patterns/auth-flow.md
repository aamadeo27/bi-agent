## auth-flow

- **email+password:** argon2id verify → issue short-lived JWT access (~15m) +
  rotating refresh in an httpOnly, Secure, SameSite cookie.
- **per-tenant SSO/OIDC:** tenant config holds the IdP; `openid-client` runs the
  code flow; on callback map the OIDC subject → tenant user (provisioned by invite).
- **invites:** tenant-admin creates a user → signed, expiring invite token emailed
  → invitee sets password (or links SSO) on accept.
- Token carries `{userId, tenantId, roleId}`; short TTL realizes GAP-17 propagation.
