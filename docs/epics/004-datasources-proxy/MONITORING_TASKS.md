# Monitoring tasks — epic 004 (data sources & restricted-credential proxy)

Epic-end monitoring pass. New production-visible surface from this epic: the credential
vault (envelope encryption), the Query Proxy L2 (credential resolution + raw-driver
exec), the data-source registry CRUD routes, and the S7 connection-test action.

Signal/alert/dashboard **specs** are in `docs/kb/monitoring.md` (§1.9, A13, A14,
Group 7). These tasks **wire the code/config** that emits and provisions them. They
land with the OTel/pino instrumentation track (epic 007 / T7.3–T7.5); run via
`04-task-feature` or fold into `13-epic-execution`.

Stay within the current tier (basic: OTel metrics/traces + pino logs, vendor-neutral).
No new code was changed in this pass — these are the follow-up units of work.

Connector exec latency/errors are **already covered** by `ask.datasource.duration.s`
(A6) and `app.error.count{error_code=DATA_SOURCE}` (A8) — do **not** add new latency
or generic-error metrics for connectors.

---

## M4.1 — Instrument credential-vault encrypt/decrypt failures

**What:** Emit failure metrics + safe pino logs from `apps/api/src/datasource/vault.ts`.
- `vault.decrypt.failure.count` counter on every `decryptCredential` throw, with
  `reason` ∈ `malformed` (JSON parse), `version_unknown` (envelope version), `crypto`
  (GCM auth-tag / decipher failure). Labels: `tenant_id`, `key_ref`.
- `vault.encrypt.failure.count` counter on `encryptCredential` / `getMasterKey` throw,
  with `reason` ∈ `master_key_missing`, `master_key_invalid`, `crypto`.
- pino `error` log on each failure carrying `requestId`/`data_source_id`/`key_ref` only.

**Acceptance criteria**
- A forced decrypt of a tampered/corrupted envelope increments
  `vault.decrypt.failure.count{reason="crypto"}` and logs **without** emitting the
  ciphertext, plaintext, DEK, or master key (assert via redaction test).
- A missing/invalid `VAULT_MASTER_KEY` increments `vault.encrypt.failure.count` with the
  matching `reason`.
- The success path emits **no** failure metric and logs no secret material.
- `reason` is coarse (the enum above) — never includes raw error detail that could leak
  envelope contents.

## M4.2 — Instrument Query Proxy credential resolution + exec span

**What:** In `apps/api/src/datasource/query-proxy.ts` `execute()`:
- Emit `datasource.credential.resolve.count` with `outcome` ∈ `resolved`,
  `credential_missing` (`ProxyCredentialNotFoundError`), `datasource_missing`
  (`ProxyDataSourceNotFoundError`). Labels: `tenant_id`, `role_name`, `data_source_kind`.
- Wrap the raw-driver execution in span `ask.exec` carrying `data_source_kind` /
  `data_source_id`, feeding the **existing** `ask.datasource.duration.s` histogram
  (monitoring.md §1.2 / A6). Do not introduce a second latency metric.

**Acceptance criteria**
- `ProxyCredentialNotFoundError` increments
  `datasource.credential.resolve.count{outcome="credential_missing"}` (not a generic 500
  counter).
- A successful execute records `ask.datasource.duration.s` labelled with the correct
  `data_source_kind`, and `...{outcome="resolved"}`.
- The decrypted credential is **never** placed on the span, in a log, or in any metric
  label (assert).

## M4.3 — Provision alerts A13 + A14 (alerts-as-code)

**What:** Add to the alert config (extends T7.4) exactly as specified in
`docs/kb/monitoring.md` §3:
- **A13** Vault credential decrypt failure — `increase(vault.decrypt.failure.count) > 0`,
  1 min, **P1 → `#sec-alerts`**, no recovery auto-close.
- **A14** Unprovisioned data-source credential —
  `increase(datasource.credential.resolve.count{outcome="credential_missing"})` > 5 in
  15 min per (tenant,role,source), **P2 → `#ops-pager`**.

**Acceptance criteria**
- Both rules exist with the stated condition / threshold / window / channel / severity.
- A13 is **excluded** from deploy-marker suppression and maintenance silencing (alongside
  A1/A2); A14 follows normal suppression.
- A synthetic `vault.decrypt.failure.count` increment fires A13 to `#sec-alerts`.

## M4.4 — Add dashboard Group 7 (dashboard-as-code)

**What:** Add the "Data sources & credential vault" panel group (extends T7.5) per
`docs/kb/monitoring.md` §4 Group 7:
- Vault decrypt failures — big single-stat, red if > 0.
- Vault encrypt failures by `reason`.
- Credential resolution outcomes by `outcome` (stacked; highlight `credential_missing`).
- Data-source test outcomes by `data_source_kind`,`outcome`.
- Data-source exec p95 by `data_source_id` — cross-link to Group 2 (reuse, don't dup).

**Acceptance criteria**
- The group renders from the metrics emitted by M4.1/M4.2 (verified against a backend
  with sample data).
- The decrypt-failure tile reads 0/green in a healthy system.

## M4.5 — Emit `datasource.test.count` when the S7 test-connection route is wired

**What:** Connectors already expose `testConnection()`, but no HTTP route invokes it yet
(the S7 "test" action lands with the admin flow). When that route is added, increment
`datasource.test.count{data_source_kind,outcome}` (`success`|`failure`) and update
`data_sources.last_tested_at` / `status`.

**Acceptance criteria**
- A successful test increments `...{outcome="success"}`; a failing test increments
  `...{outcome="failure"}` and surfaces on dashboard Group 7.
- No credential/connection-config value appears in the test response, logs, or metric
  labels.

> Note: this task is gated on the S7 test-connection **route** existing (functional work,
> not monitoring). If that route is implemented in epic 005/006, attach this metric there
> rather than creating a standalone task.
