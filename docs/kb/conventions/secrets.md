# Secrets Management

---

## Where secrets live per environment

| Environment | Store | Access mechanism |
|-------------|-------|-----------------|
| Local dev | `.env.local` (gitignored, never committed) | Loaded by `dotenv` at process start |
| CI (GitHub Actions) | GitHub Actions encrypted secrets | Injected as env vars into job steps |
| Staging | GCP Secret Manager (staging project) | Cloud Run secret references → env vars at container start |
| Prod | GCP Secret Manager (prod project) | Cloud Run secret references → env vars at container start |

---

## How secrets reach the app

- **Local dev:** developers copy `.env.example` to `.env.local` and fill in their
  own values. `.env.local` is in `.gitignore` (enforced). `dotenv` loads it at
  `apps/api` startup (`import 'dotenv/config'` at the top of the entry point).
- **Staging / Prod (Cloud Run):** secrets are referenced in the Cloud Run service
  definition by name + version (`projects/<id>/secrets/<name>/versions/latest`).
  Cloud Run injects them as environment variables at container startup. They are
  never baked into the Docker image.
- **CI:** GitHub Actions secrets are set in the repo settings
  (Settings → Secrets and variables → Actions). Referenced in workflow YAML as
  `${{ secrets.SECRET_NAME }}`. Never echoed in logs.

---

## Required secrets list

### Global runtime secrets

| Name | Description | Rotation |
|------|-------------|----------|
| `DATABASE_URL` | Control-plane Postgres connection string (includes user + password) | On credential rotation or DB migration |
| `GEMINI_API_KEY` | Google Gemini API key (default LLM provider) | Quarterly or on compromise |
| `JWT_ACCESS_SECRET` | HMAC signing key for short-lived access tokens (~15 min) | Annually or on compromise; rolling rotation |
| `JWT_REFRESH_SECRET` | HMAC signing key for rotating refresh tokens (httpOnly cookie) | Annually or on compromise; rolling rotation |
| `KMS_KEY_REF` | GCP Cloud KMS key resource name used as the envelope master key for the credential vault | Never deleted (KMS manages versions); new version added on rotation |

### CI secrets

| Name | Description |
|------|-------------|
| `TURBO_TOKEN` | Turborepo remote cache authentication token |
| `TURBO_TEAM` | Turborepo remote cache team identifier |
| `DEV_DATABASE_URL` | Dev/CI Postgres URL (for integration tests) |
| `STAGING_DATABASE_URL` | Staging Postgres URL (for staging deploy job) |
| `STAGING_GEMINI_API_KEY` | Gemini key used in staging CI E2E runs |
| `GCP_SERVICE_ACCOUNT_KEY` | SA key (or Workload Identity Federation preferred) for image push + deploy |

### Per-tenant secrets (NOT global env vars)

Per-tenant OIDC credentials (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) are stored
encrypted in the control-plane DB using the KMS envelope-encrypted credential
vault. They are fetched at runtime by the Auth/Identity module per tenant request,
not injected as global env vars. Only `KMS_KEY_REF` is a global secret needed
to decrypt them.

---

## Local dev story

1. `cp .env.example .env.local` (`.env.example` committed with placeholder values;
   `.env.local` gitignored).
2. Fill in `DATABASE_URL` pointing to a local or dev-tier Postgres.
3. Fill in `GEMINI_API_KEY` with a personal/dev API key (low quota tier is fine).
4. For KMS in local dev: use a test KMS emulator or a static local key (see
   `apps/api/src/datasource/vault/local-test-key.ts`). Never use the prod KMS key
   locally.
5. JWT secrets: any random string works locally
   (`openssl rand -hex 32`).
6. OIDC: per-tenant SSO is not needed for most local development; the
   email+password flow works without it.

---

## Hard rules

1. **No secrets in git** — not in source code, not in committed config files, not
   in `Dockerfile` ENV instructions, not in CI workflow YAML (only references to
   `${{ secrets.NAME }}`).
2. **No secrets in logs** — pino must redact fields matching `password`, `token`,
   `secret`, `key`, `credential`, `authorization`. Enforce via pino `redact` config
   in `apps/api/src/lib/logger.ts`. Code review rejects any log call that passes
   a credential object.
3. **No secrets in client bundles** — Vite strips `VITE_*`-prefixed vars into the
   bundle. No secret may have a `VITE_` prefix. The Vite build CI step must not
   have secret env vars in scope.
4. **No secrets in error responses** — the error-handling middleware must not echo
   env vars or internal connection strings. Typed error codes only (see contracts.md
   error-codes).
5. **Credential vault decryption happens in memory only** — the Query Proxy
   decrypts per-(tenant,role,source) credentials for the duration of a single
   request and does not cache the plaintext beyond the connection lifetime.

---

## Rotation guidance

| Secret | Rotation trigger | Procedure |
|--------|-----------------|-----------|
| `DATABASE_URL` (password part) | Quarterly or on suspected compromise | Update Postgres user password → update Secret Manager version → rolling Cloud Run redeploy (zero-downtime) |
| `GEMINI_API_KEY` | Quarterly or on compromise | Create new key in GCP AI Studio → update Secret Manager → redeploy |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Annually or on compromise | Add new secret version → update app to accept old + new for a 15-min window → remove old version |
| `KMS_KEY_REF` (new KMS version) | Annually or per security policy | Create new KMS key version; re-encrypt all vault entries with new version; disable old version |
| Per-tenant OIDC secrets | On tenant request or IdP rotation | Tenant admin updates via Admin UI (when built) or ops script; re-encrypts in vault |

---

## `.gitignore` entries (required)

```
.env
.env.local
.env.*.local
*.pem
*.key
```

Verify these are present in the root `.gitignore` before first commit. A CI lint
step should fail if any of these file patterns appear in the staged diff.
