# Epic 002 — Auth & tenant isolation

Authentication (email+password + optional per-tenant OIDC), invite-based
provisioning, sessions with short-lived tokens, and the server-side tenant-scope
middleware that makes cross-tenant access impossible by construction.

## Motivation
Covers NFR-SEC-5, NFR-MT-1, the locked auth decision (email+password + per-tenant
SSO/OIDC, tenant-admin invite), and GAP-17 (near-session propagation via short
tokens). UI flows: S1 Login, S10 Account, invite flow placeholder in S6.

## Definition of Done
- A user can log in with email+password; a tenant can configure OIDC and users can
  log in via SSO.
- Tenant admins can invite users by email; invitees accept and set password/link SSO.
- Every authenticated request carries `{userId, tenantId, roleId}` from the token
  and is tenant-scoped server-side; client-supplied tenant ids are ignored.
- Access tokens are short-lived (~15m); refresh rotates via httpOnly cookie.

## deps: 001

## Dependency graph & parallelism plan

Wave 1 (parallel): T2.1, T2.5
Wave 2 (serial T2.2 then T2.3): T2.2, T2.3
Wave 3 (parallel): T2.4, T2.6

- T2.1 (tenant-scope middleware) and T2.5 (login UI) are independent starts.
- T2.2 (password auth + tokens) precedes T2.3 (OIDC) — both touch the auth module/session model; serialize to avoid contention.
- T2.4 (invites) and T2.6 (account/profile + me) build on T2.2/T2.3.

## Risks / open questions
- GAP-17 propagation lag (token TTL, ~15 min) confirmed as acceptable for v1.
