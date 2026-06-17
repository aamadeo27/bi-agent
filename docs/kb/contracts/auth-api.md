## auth-api

- `POST /api/auth/login` → `{ accessToken }` + sets refresh cookie (httpOnly).
- `POST /api/auth/refresh` → rotates tokens (realizes GAP-17 near-session propagation).
- `POST /api/auth/logout` → revokes refresh.
- `GET  /api/auth/sso/:tenant/start` + `/callback` → OIDC code flow (openid-client).
- `POST /api/auth/invite/accept` → set password / link SSO from invite token.
- `GET  /api/me` → `{ user, role, capabilities, tenant }` for the SPA shell.

Access token claims: `{ sub: userId, tenantId, roleId, exp (~15m) }`.
