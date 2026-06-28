# Monitoring config — BI Result Presenter

> Concrete config derived from `monitoring-direction.md` (direction) + `system-design.md`
> (components) + `devops.md` (stack). This doc is the source of truth for the
> **metrics catalog**, **alert rules**, and **dashboard layout**. The instrumentation
> that emits these signals is `007-audit-observability/T7.3` (OTel + pino). Provisioning
> the alerts/dashboards-as-code is `T7.4` and `T7.5` (see that epic).

## Level & stack

- **Level: basic for v1, upgradeable.** Platform-native first (Cloud Run request
  metrics + Cloud Logging), plus app-emitted OTel metrics/traces and pino logs for
  the domain signals platform metrics can't see (gate decisions, LLM tokens, gate
  bypass).
- **Stack:** OpenTelemetry (traces + metrics) + pino (structured JSON logs),
  correlated by `requestId`/trace id. **Vendor-neutral**: every alert/dashboard below
  is expressed as *metric name + condition + threshold + window* so it maps onto Cloud
  Monitoring, Grafana/Prometheus, or any OTLP backend without rework.
- **Cost tier:** Cloud Run request metrics + Cloud Logging + Cloud Monitoring are
  in-platform (effectively free at v1 volume; pay on log/metric volume only). No paid
  APM/RUM/on-call vendor in v1. Upgrade triggers (not met yet): contractual SLA,
  high traffic, compliance paging.

## Standing label rules (apply to every metric below)

- **Allowed labels:** `tenant_id` (opaque id, never tenant name), `role_name`,
  `provider`, `model`, `data_source_id`, `data_source_kind` (pg/mysql/bq/rest),
  `error_code`, `outcome`, `env`, `service`. `user_id` and `request_id` go on
  **logs/spans only**, never as metric labels (cardinality + PII).
- **Never a label / never logged:** credentials, tokens, secrets, SQL literals,
  queried row values, schema *data* (object names in block reasons are counts-by-kind
  only). pino redaction (`password`/`token`/`secret`/`key`/`credential`) per
  devops §6.3 is mandatory.
- Histograms use OTel default explicit buckets unless a custom bucket set is noted.

---

## 1. Metrics catalog

Metric names use OTel dotted convention (`{prefix}.{noun}.{unit}`). Counters are
monotonic; durations are histograms in **seconds**.

### 1.1 Security gate (L1) — critical

| Metric | Type | Labels | Source span / event |
|--------|------|--------|---------------------|
| `gate.decision.count` | counter | `tenant_id`, `role_name`, `outcome`(`allow`\|`block`) | ask pipeline step 4 span `ask.gate` |
| `gate.block.missing.count` | counter | `tenant_id`, `role_name`, `missing_kind`(`schema`\|`table`\|`column`) | step 4 block payload (counts only, no names) |
| `gate.bypass.count` | counter | `tenant_id`, `role_name`, `stage`(`l1_allowed_ungranted`\|`l2_executed_unapproved`) | invariant check at step 6 (see §1.2) |
| `gate.error.count` | counter | `tenant_id`, `role_name` | step 4 span error status (gate threw / could not evaluate) |

**`gate.bypass.count` is the single most important security metric.** It is emitted
only when an *invariant is violated*: (a) L1 returned **allow** for a query whose
resolved resource set is **not** a subset of the role grants, or (b) the Query Proxy
(L2) is about to execute a query that the gate did **not** stamp as approved
(approval token / decision id mismatch). In a correct system this counter is always
**0**. Any non-zero value is a high-severity page (alert A1).

> Implementation note (gate T5.2 + orchestrator T5.5 + Query Proxy T4.4; emitted via instrumentation T7.3): step 4 must attach an explicit *gate-decision id* (or
> approved-resource-set hash) to the request context; step 6 (Query Proxy) must
> assert that the query it is executing carries a matching approval before opening the
> restricted connection. A missing/mismatched approval increments
> `gate.bypass.count{stage=l2_executed_unapproved}` and **aborts the execution**.

### 1.2 Query pipeline latency

| Metric | Type | Labels | Source span / event |
|--------|------|--------|---------------------|
| `ask.e2e.duration.s` | histogram | `tenant_id`, `outcome`(`answered`\|`blocked`\|`clarification`\|`error`) | root span `ask.request` (submit → result envelope sent) |
| `ask.ttfb.duration.s` | histogram | `tenant_id` | submit → first SSE token (`ask.stream.first_token`) |
| `ask.llm.duration.s` | histogram | `tenant_id`, `provider`, `model` | span `ask.llm.generate` |
| `ask.datasource.duration.s` | histogram | `tenant_id`, `data_source_kind` | span `ask.exec` (Query Proxy, raw driver) |
| `ask.gate.duration.s` | histogram | `tenant_id` | span `ask.gate` |
| `ask.requests.count` | counter | `tenant_id`, `outcome` | root span close |

> Buckets for `ask.e2e.duration.s` and `ask.ttfb.duration.s` are tuned to the 6 s SLO:
> `[0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 12, 20]` so the p95-vs-6s boundary has resolution.

### 1.3 LLM cost / tokens

| Metric | Type | Labels | Source span / event |
|--------|------|--------|---------------------|
| `llm.tokens.count` | counter | `tenant_id`, `provider`, `model`, `direction`(`in`\|`out`) | span `ask.llm.generate` usage |
| `llm.cost.usd` | counter | `tenant_id`, `provider`, `model` | derived from tokens × per-model unit price (config map) |
| `llm.context.tokens` | histogram | `tenant_id`, `model` | prompt-assembly span (budget is ~8k, GAP-8) |
| `llm.error.count` | counter | `tenant_id`, `provider`, `model` | `ask.llm.generate` error status |

> `llm.cost.usd` is computed in-app from a `{provider,model} → {inputPer1k, outputPer1k}`
> price map so cost is attributable per tenant without a billing-API round-trip. Price
> map lives in config; update it on provider/model change. `provider`+`model` labels
> make a provider swap (Gemini → other) immediately visible.

### 1.4 Error states (taxonomy = contracts `error-codes`)

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `app.error.count` | counter | `tenant_id`, `error_code`, `class`(`expected`\|`failure`) | error-handling middleware + pipeline |

- `error_code` ∈ `GATE_BLOCK | CLARIFICATION | VALIDATION | DATA_SOURCE | LLM_ERROR | AUTH | TENANT | NOT_FOUND | RATE_LIMIT | INTERNAL`.
- `class` splits **expected** (`GATE_BLOCK`, `CLARIFICATION`, `VALIDATION`,
  `NOT_FOUND`, `RATE_LIMIT`) from **failures** (`DATA_SOURCE`, `LLM_ERROR`,
  `TENANT`, `INTERNAL`, `AUTH` when unexpected). Alerts fire on the **failure** class;
  expected outcomes are dashboarded, not paged.

### 1.5 Throughput & tenant isolation

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `http.server.requests.count` | counter | `service`, `route`, `status_class`(`2xx`/`4xx`/`5xx`) | OTel HTTP auto-instrumentation |
| `http.server.duration.s` | histogram | `service`, `route` | OTel HTTP auto-instrumentation |
| `tenant.request.count` | counter | `tenant_id` | tenant-scope middleware (per-tenant volume) |
| `tenant.crosstenant.attempt.count` | counter | `tenant_id`, `vector`(`body_id`\|`object_ref`) | tenant-scope middleware when a cross-tenant id is ignored |

> `tenant.crosstenant.attempt.count` is the **tenant-isolation** signal. The middleware
> already *ignores* cross-tenant ids by construction (NFR-MT-1); this metric counts
> how often that defense triggers. A sustained source is a probing signal → alert A2.

### 1.6 SSE streaming health

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `sse.streams.active` | up-down counter | `service` | stream open/close (streaming-sse pattern) |
| `sse.stream.start.duration.s` | histogram | `tenant_id` | accept → first byte flushed |
| `sse.stream.aborted.count` | counter | `tenant_id`, `reason`(`client_disconnect`\|`timeout`\|`server_error`) | stream teardown |

### 1.7 Auth

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `auth.login.count` | counter | `tenant_id`, `outcome`(`success`\|`failed`), `method`(`password`\|`oidc`) | Auth module / `login` + `login_failed` events |
| `auth.token.refresh.count` | counter | `tenant_id`, `outcome`(`success`\|`failed`) | token refresh handler |

### 1.8 Health / uptime

| Probe | Definition |
|-------|------------|
| `GET /health` | DB ping + process check (devops §3.1). Cloud Run health probe + one external uptime check (60 s interval) per env. |

### 1.9 Data-source proxy & credential vault (epic 004)

> New surface added by epic 004 (registry CRUD, connectors, credential vault, Query
> Proxy L2). Instrumentation is tracked in
> `docs/epics/004-datasources-proxy/MONITORING_TASKS.md` and lands with the OTel/pino
> wiring (epic 007 / T7.3). Connector exec **latency/errors** are NOT re-counted here —
> they roll up under `ask.datasource.duration.s` (§1.2, A6) and
> `app.error.count{error_code=DATA_SOURCE}` (§1.4, A8) once epic 005 wires the proxy
> into the ask pipeline.

| Metric | Type | Labels | Source span / event |
|--------|------|--------|---------------------|
| `vault.decrypt.failure.count` | counter | `tenant_id`, `key_ref`, `reason`(`malformed`\|`version_unknown`\|`crypto`) | `decryptCredential` throw (`datasource/vault.ts`) |
| `vault.encrypt.failure.count` | counter | `reason`(`master_key_missing`\|`master_key_invalid`\|`crypto`) | `encryptCredential` / `getMasterKey` throw (`datasource/vault.ts`) |
| `datasource.credential.resolve.count` | counter | `tenant_id`, `role_name`, `data_source_kind`, `outcome`(`resolved`\|`credential_missing`\|`datasource_missing`) | Query Proxy `execute()` (`datasource/query-proxy.ts`) |
| `datasource.test.count` | counter | `tenant_id`, `data_source_kind`, `outcome`(`success`\|`failure`) | S7 test-connection action (connector `testConnection`) |

- **`vault.decrypt.failure.count` is a security signal.** AES-256-GCM auth-tag failure
  (`reason=crypto`) means the stored envelope was tampered with **or** the master key
  changed — either way L2 execution breaks. `reason` is coarse and carries **no**
  ciphertext, plaintext, or key material (standing label rules apply). → alert **A13 (P1)**.
- `vault.encrypt.failure.count` is an **operational/config** signal (master key missing
  or wrong length ⇒ data-source admin writes 500). Dashboarded; also caught by the 5xx
  alert (A9). No separate page — low-frequency admin action.
- `datasource.credential.resolve.count{outcome=credential_missing}` surfaces an
  **unprovisioned (tenant, role, source)** mapping — the operationally-heavy per-role
  DB-role provisioning gap flagged in the epic risks. In epic 005 this becomes a
  user-visible `DATA_SOURCE` failure; here it is the provisioning-backlog signal. → A14.
- `datasource.test.count` reflects the S7 admin "test" action. Failures are an admin
  misconfiguration signal (expected, dashboarded — not paged).

---

## 2. SLOs / thresholds (from GAP-8 perf caps + devops SLO)

| SLO | Target | Metric | Window |
|-----|--------|--------|--------|
| Ask end-to-end latency | **p95 < 6 s** (excl. slow data sources) | `ask.e2e.duration.s` p95 | rolling 30 min |
| Availability | **99.5% uptime** | `/health` uptime check success ratio | 30-day |
| Result row cap honored | **≤ 10 000 rows** per query | result-envelope row count (logged); guardrail in validator | per request |
| LLM context budget | **~8k context tokens** | `llm.context.tokens` p95 | rolling 1 h |
| Gate bypass invariant | **0** bypass/errors | `gate.bypass.count`, `gate.error.count` | always |

> "Excluding slow data sources": the e2e SLO is evaluated on
> `ask.e2e.duration.s − ask.datasource.duration.s` where data-source time is the
> dominant outlier (use a recording rule / derived metric `ask.e2e.app.duration.s`).
> `ask.datasource.duration.s` is alerted separately (A6) so a slow tenant source is
> isolated rather than blamed on the app.

---

## 3. Alert rules

Severity: **P1 = page immediately** (security or hard outage), **P2 = notify
on-call channel** (SLO burn / elevated failures), **P3 = ticket/daily digest**
(trend/anomaly). Channels are placeholders to be bound at backend wire-up
(T7.4): `#sec-alerts` (P1 security), `#ops-pager` (P1/P2 ops), `#ops-digest` (P3).

### Security (highest priority)

| ID | Name | Condition | Threshold | Window | Severity | Why / action |
|----|------|-----------|-----------|--------|----------|--------------|
| **A1** | **Permission-gate bypass or error** | `increase(gate.bypass.count) > 0` **OR** `increase(gate.error.count) > 0` | **any** (> 0) | 1 min, no recovery auto-close | **P1 — page `#sec-alerts`** | L1 allowed an ungranted resource, or L2 executed a query the gate didn't approve, or the gate failed to evaluate. This is a security-control failure. Action: treat as incident — capture `requestId`/trace, confirm L2 credential still blocked execution (defense-in-depth backstop), freeze affected role if needed. **Must never be silenced by deploy suppression.** |
| **A2** | Cross-tenant access attempts | `rate(tenant.crosstenant.attempt.count)` by `tenant_id` | > 5 / 5 min from one tenant | 5 min | P2 → escalate P1 if sustained 30 min | Possible probing / broken client. Action: inspect source user, confirm middleware ignored it (it always should), check for a bug in client id handling. |
| **A3** | Gate-block spike (single role) | `increase(gate.decision.count{outcome="block"})` by `tenant_id,role_name` | > 20 in 10 min for one role **and** > 3× that role's 7-day baseline | 10 min | P2 `#ops-pager` | Spike of blocks for one user/role = probing or a broken grant. Action: review grants vs the queries being blocked; not a failure by itself, but anomalous. |
| **A4** | Auth failure spike | `rate(auth.login.count{outcome="failed"})` by `tenant_id` | > 10 / 5 min per tenant | 5 min | P2 `#ops-pager` | Credential stuffing / misconfigured SSO. Action: check source, consider rate-limit/lockout. |
| **A13** | **Vault credential decrypt failure** | `increase(vault.decrypt.failure.count) > 0` | **any** (> 0) | 1 min, no recovery auto-close | **P1 — page `#sec-alerts`** | A stored credential envelope failed to decrypt. GCM auth-tag failure (`reason=crypto`) = tampering of `cred_vault_refs` at rest **or** a master-key mismatch — breaks L2 and may indicate compromise. Action: treat as incident — capture `requestId`/trace + `data_source_id`/`key_ref` (never the blob/plaintext), check KMS master-key/rotation state, verify cred-vault integrity. **Never silenced by deploy/maintenance suppression.** |

### Latency / availability (SLO)

| ID | Name | Condition | Threshold | Window | Severity | Why / action |
|----|------|-----------|-----------|--------|----------|--------------|
| A5 | Ask p95 over SLO | `histogram_quantile(0.95, ask.e2e.app.duration.s) > 6` | > 6 s | rolling 30 min, recover when < 5 s for 10 min | P2 `#ops-pager` | Direct SLO breach (app-side, data-source time excluded). Action: check LLM vs gate vs app spans on the latency dashboard. |
| A6 | Data-source latency high | `histogram_quantile(0.95, ask.datasource.duration.s)` by `data_source_id` > 8 s | > 8 s | 30 min | P3 `#ops-digest` | Isolates a slow tenant source (excluded from the app SLO). Action: notify tenant / check connector + timeout. |
| A7 | Availability burn | `/health` uptime success ratio < 99.5% | < 99.5% | 1 h fast-burn | P1 `#ops-pager` | Service down / DB unreachable. Action: check Cloud Run revision + Cloud SQL. |

### Failures / cost / streaming

| ID | Name | Condition | Threshold | Window | Severity | Why / action |
|----|------|-----------|-----------|--------|----------|--------------|
| A8 | Failure-class error rate | `rate(app.error.count{class="failure"}) / rate(ask.requests.count) > 0.05` | > 5% | 15 min | P2 `#ops-pager` | Real failures (DATA_SOURCE/LLM/INTERNAL/TENANT), not expected blocks/clarifications. Action: break down by `error_code` on the errors dashboard. |
| A9 | 5xx rate | `rate(http.server.requests.count{status_class="5xx"}) / total > 0.02` | > 2% | 10 min | P2 `#ops-pager` | Unhandled server errors. |
| A10 | LLM error rate | `rate(llm.error.count) / rate(ask.requests.count) > 0.05` | > 5% | 15 min | P2 `#ops-pager` | Provider outage / quota. Action: check `provider`/`model`; provider abstraction lets you fail over by config. |
| A11 | Tenant LLM cost anomaly | `increase(llm.cost.usd[1d])` by `tenant_id` > 3× that tenant's trailing 7-day daily mean **and** > $5/day floor | trend | 1 day | P3 `#ops-digest` | Budget signal / runaway usage. Floor avoids paging on tiny absolute spikes. Action: review tenant query volume; consider per-tenant rate limit. |
| A12 | Aborted-stream / leak | `rate(sse.stream.aborted.count{reason!="client_disconnect"})` high **or** `sse.streams.active` > N and rising for 15 min | abort > 1/min sustained, or active streams flat-high | 15 min | P3 `#ops-digest` | Back-pressure or leaked streams (client disconnects are normal and excluded). Action: check stream teardown / timeout handling. |
| A14 | Unprovisioned data-source credential | `increase(datasource.credential.resolve.count{outcome="credential_missing"})` by `tenant_id,role_name,data_source_kind` | > 5 in 15 min for one (tenant,role,source) | 15 min | P2 `#ops-pager` | A role is hitting a source with **no provisioned least-privilege credential** (per-role DB-role provisioning gap). In epic 005 this fails the user's query. Action: provision the restricted credential for that (tenant,role,source) — not a code bug. |

### Suppression / dedup

- **Deploy suppression:** A5–A10, A12, A14 are silenced for 10 min after a deploy marker
  (Cloud Run new-revision event) to avoid cold-start noise. **A1 (gate bypass/error),
  A2 (cross-tenant), and A13 (vault decrypt failure) are NEVER suppressed** — a
  security-control failure during a deploy is still an incident.
- **Maintenance windows:** ops can silence A5–A12, A14 during announced maintenance;
  A1/A2/A13 cannot be silenced (require an explicit, audited override).
- **Dedup:** group by `alertname` + `tenant_id` so one bad tenant doesn't fan out into
  N pages.

---

## 4. Dashboard layout

One Cloud Monitoring / Grafana dashboard, six panel groups. Vendor-neutral panel
specs (metric + aggregation); import as JSON via T7.5.

### Group 1 — Security gate (top, always visible)
- **Gate bypass / error (BIG SINGLE-STAT, red if > 0):** `gate.bypass.count` +
  `gate.error.count` totals. The headline tile.
- Allow vs block over time: `gate.decision.count` by `outcome` (stacked).
- Block reasons: `gate.block.missing.count` by `missing_kind`.
- Top roles by block rate: `gate.decision.count{outcome=block}` by `role_name` (table).
- Cross-tenant attempts: `tenant.crosstenant.attempt.count` by `tenant_id`.

### Group 2 — Query pipeline latency
- Ask e2e p50 / p95 / p99 (app, data-source excluded), with the **6 s SLO line**.
- Latency breakdown stacked: gate vs LLM vs data-source vs app overhead.
- TTFB (submit → first token) p50/p95.
- Data-source p95 by `data_source_kind` / `data_source_id`.

### Group 3 — LLM cost & tokens
- Tokens in/out over time by `model`.
- Cost (USD) per tenant — top N (table + trend).
- Context-size p95 vs the ~8k budget line.
- LLM error rate + provider/model in use (to spot a swap).

### Group 4 — Errors
- Error rate by `error_code` (stacked), split expected vs failure class.
- 5xx rate (`http.server.requests.count`).
- Failure breakdown table by `error_code` + `tenant_id`.

### Group 5 — SSE streaming health
- Active streams (`sse.streams.active`) over time.
- Stream start latency p95.
- Aborted streams by `reason` (client_disconnect separated out).

### Group 6 — Auth & throughput
- Logins success/failed by `method`; failed-login spikes.
- Token-refresh success/failed.
- Requests/sec by `status_class`; per-tenant request volume (`tenant.request.count`).

### Group 7 — Data sources & credential vault (epic 004)
- **Vault decrypt failures (BIG SINGLE-STAT, red if > 0):** `vault.decrypt.failure.count` — headline tile (A13).
- Vault encrypt failures: `vault.encrypt.failure.count` by `reason`.
- Credential resolution outcomes: `datasource.credential.resolve.count` by `outcome` (stacked) — watch `credential_missing` (unprovisioned roles, A14).
- Data-source test outcomes: `datasource.test.count` by `data_source_kind`,`outcome` (S7 admin "test").
- Data-source exec p95 by `data_source_id` / `data_source_kind` — cross-link to Group 2 / A6 (not duplicated here).

---

## 5. Logs (pino)

- **Format:** structured JSON; one line per request-significant event. Every line
  carries `requestId` (= trace id), `tenantId`, `userId`, `roleName`, plus span
  context where available.
- **Redaction:** `password`, `token`, `secret`, `key`, `credential` redacted at the
  logger (devops §6.3). No SQL literals or row values.
- **Retention:** platform default (Cloud Logging) — keep operational logs **30 days**
  (cheapest tier; raise only if compliance requires). The **persisted audit log**
  (contracts `audit-event`, T7.1) is the long-lived 365-day security record and is
  separate from these operational logs.
- **Log-based signals** (where a metric is overkill): gate-block detail lines and
  cross-tenant-ignored lines double as a quick log query for incident triage:
  `error_code="GATE_BLOCK"` and `event="crosstenant.ignored"`.

---

## 6. Mapping back to the must-be-observable list

| Direction signal | Covered by |
|------------------|-----------|
| Gate decisions allow/block + reason | `gate.decision.count`, `gate.block.missing.count` (Group 1) |
| **Gate bypass / error (L1/L2)** | `gate.bypass.count`, `gate.error.count` → **alert A1 (P1)** |
| Query latency p50/p95/p99 + data-source + LLM split | `ask.*` histograms (Group 2), SLO A5/A6 |
| LLM cost/tokens per request + per tenant | `llm.tokens.count`, `llm.cost.usd` (Group 3), A11 |
| Error taxonomy (expected vs failure) | `app.error.count{error_code,class}` (Group 4), A8 |
| Throughput & error rate | `http.server.*`, `tenant.request.count` (Group 6), A9 |
| Tenant isolation / cross-tenant | `tenant.crosstenant.attempt.count` (Group 1), A2 |
| SSE streaming health | `sse.*` (Group 5), A12 |
| Auth (failed logins, token refresh) | `auth.login.count`, `auth.token.refresh.count` (Group 6), A4 |
| **Credential vault decrypt/encrypt health** (epic 004) | `vault.decrypt.failure.count`, `vault.encrypt.failure.count` (Group 7) → **A13 (P1)** |
| Restricted-credential provisioning gaps (epic 004) | `datasource.credential.resolve.count` (Group 7), A14 |
| Data-source connection test (S7) | `datasource.test.count` (Group 7) |
