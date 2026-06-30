# Monitoring tasks — epic 005 (ask pipeline: agent + permission gate)

Epic-end monitoring pass. New production-visible surface from this epic: the **ask
orchestrator + SSE endpoint** (`ask/orchestrator.ts`), the **permission gate**
(`ask/permission-gate.ts`), the **query validator / injection guard**
(`ask/query-validator.ts`), the **LLM provider port + Gemini adapter** (`llm/*`),
**chart-type selection** (`ask/select-chart-type.ts`), the **query-inspect endpoint**
(`messages/router.ts`, T5.7), and a **scheduled retention purge job**
(`conversations/retention-scheduler.ts` → `retention-purge.ts`, T5.8, GAP-4).

Signal / alert / dashboard **specs** are in `docs/kb/monitoring.md`. The request-path
ask metrics (gate decisions, e2e/ttfb/llm latency, tokens/cost, SSE, error taxonomy)
were **already specced** in §1.1–§1.7 and their instrumentation is the OTel/pino track
(epic 007 / T7.3–T7.5) — **do not re-add them here.** These tasks wire the code/config
for the surface that pass introduced and §1.1–§1.7 did **not** already cover:

- the **gate-approval token** the bypass metric (A1) depends on — now that orchestrator
  + Query Proxy are both concrete, the L1→L2 invariant has a real seam to assert (§1.1),
- the **retention purge job** (§1.10, A15) — a non-request-path job invisible to §1.1–§1.7,
- the **injection-guard reject reason** split (§1.10, A16).

Stay within the current tier (basic: OTel metrics/traces + pino logs, vendor-neutral).
No code was changed in this pass — these are the follow-up units of work. Run via
`04-task-feature`, or fold into `13-epic-execution`.

**Already covered — no task needed:**
- Query-inspect endpoint (`GET /api/messages/:id/query`, T5.7) → rolls up under
  `http.server.requests.count{route}` / `http.server.duration.s` (§1.5). Its `canInspectQuery`
  403 denials are low-volume and not independently actionable — **no** dedicated metric/alert.
- Provider swap visibility → already on `provider`/`model` labels of `llm.*` (§1.3, A10).
- Chart-type selection is pure/in-process → no runtime signal.

---

## M5.1 — Plumb the gate-approval token so `gate.bypass.count` can be emitted (A1)

**What:** The single most important security metric, `gate.bypass.count{stage=l2_executed_unapproved}`
(§1.1, A1 P1), requires the Query Proxy to **prove** the query it is about to execute was
the one the gate approved. Today `datasource/query-proxy.ts` `execute()` takes **no**
approval argument — the orchestrator calls the gate then calls the proxy with no binding
seam, so the bypass invariant cannot be checked or counted.

- In `ask/orchestrator.ts` step 4: after the gate returns `allow`, compute a
  **gate-decision id** = stable hash of the *resolved, gate-approved resource set*
  (schema.table.column tuples) for this request, and carry it on the request context.
- In `datasource/query-proxy.ts` `execute()`: accept that decision id (or approved-set
  hash) and, before opening the restricted connection, assert the query's
  re-extracted resource set matches it. On mismatch/missing →
  increment `gate.bypass.count{stage=l2_executed_unapproved}` and **abort execution**.
- Also emit `gate.bypass.count{stage=l1_allowed_ungranted}` if the gate ever returns
  `allow` for a resolved set that is **not** a subset of the role grants (defensive
  cross-check at the orchestrator boundary).

**Acceptance criteria**
- `execute()` rejects (and increments `gate.bypass.count{stage=l2_executed_unapproved}`)
  when called with a query whose resource set does not match the supplied approval token —
  proven by a test that calls the proxy with a tampered query + a valid token.
- The normal allow path passes the token end-to-end and emits **no** bypass counter.
- The token/hash carries **no** SQL text, literals, or row data (counts/hashes only).
- A1 (`increase(gate.bypass.count) > 0`) has a real signal to fire on; in a correct
  run the counter stays 0.

## M5.2 — Instrument the retention purge job (T5.8)

**What:** Emit metrics from `conversations/retention-scheduler.ts` +
`conversations/retention-purge.ts` (the job currently only logs).
- `retention.purge.run.count{outcome}` — `success` on `retention_purge_complete`,
  `fatal` on `retention_purge_fatal`.
- `retention.purge.last_success.timestamp` gauge (unix seconds) — **set on each
  `retention_purge_complete` whose `tenantsErrored == 0`.** This is what A15 watches.
- `retention.purge.tenants.errored.count` — add per-run `tenantsErrored`.
- `retention.purge.deleted.count` — add per-run total `deletedConversations`.
- Keep the existing counts-only pino logs (`retention_purge_summary` / `_error` /
  `_complete` / `_fatal`); they carry no conversation ids, user ids, or content.

**Acceptance criteria**
- A run that completes with `tenantsErrored == 0` advances
  `retention.purge.last_success.timestamp` to ~now and increments
  `retention.purge.run.count{outcome="success"}`.
- A thrown run increments `retention.purge.run.count{outcome="fatal"}` and does **not**
  advance the freshness gauge.
- A run where one tenant throws but the job completes leaves the freshness gauge
  **un-advanced** (tenantsErrored > 0) and increments `retention.purge.tenants.errored.count`.
- No conversation/user id, title, or message content appears on any metric label or log.

## M5.3 — Emit `ask.validation.reject.count{reason}` from the validator path

**What:** In the orchestrator's step-5 validator branch (`ask/orchestrator.ts` calling
`ask/query-validator.ts`), increment `ask.validation.reject.count` with a `reason` label
mapped from the validator's rejection cause: `non_select` | `dml` | `ddl` |
`multi_statement` | `row_limit` | `too_long` | `parse_error`. Labels: `tenant_id`, `reason`.
This splits the existing `app.error.count{error_code=VALIDATION}` (§1.4) by reason so the
**security** reasons (model emitted a write/destructive/stacked statement) are visible
apart from benign parse failures.

**Acceptance criteria**
- A DML/DDL/multi-statement/non-SELECT rejection increments the counter with the matching
  `reason`; a too-long / unparseable query maps to `too_long` / `parse_error`.
- The label carries **no** SQL text or literals — only the coarse reason enum.
- The existing `app.error.count{error_code="VALIDATION"}` still fires (this is additive,
  not a replacement) and the `query_validation_failed` audit event is unaffected.
- A16 (`increase(ask.validation.reject.count{reason=~"non_select|dml|ddl|multi_statement"})`)
  has a signal; benign reasons are excluded from it.

## M5.4 — Provision alerts A15 + A16 and dashboard Group 8 (alerts/dashboards-as-code)

**What:** Add the epic-005 alerts and dashboard group to the alerts/dashboards-as-code
provisioned by epic 007 (T7.4 alerts, T7.5 dashboards):
- **A15** — Retention purge stale/failing: `time() − retention.purge.last_success.timestamp
  > 90000` (25 h) **OR** `increase(retention.purge.run.count{outcome="fatal"}) > 0` → P2
  `#ops-pager`; per-tenant `retention.purge.tenants.errored.count > 0` (run still completes)
  → P3 `#ops-digest`. Not deploy-suppressed.
- **A16** — Injection-guard reject spike: `increase(ask.validation.reject.count
  {reason=~"non_select|dml|ddl|multi_statement"})` by `tenant_id,role_name` > 15 in 1 h
  and > 3× the role's 7-day baseline → P3 `#ops-digest`. Benign reasons excluded.
- **Dashboard Group 8** (monitoring.md §4): purge-freshness big single-stat (red > 25 h),
  purge runs by outcome + tenants-errored overlay, deleted-per-run trend, injection-guard
  rejects by reason (security reasons highlighted).

**Acceptance criteria**
- A15 fires when the freshness gauge is stale > 25 h **and** auto-resolves only after a
  fresh clean run lands; a forced `fatal` run also fires it.
- A16 fires only on the security-reason regex and respects the per-(tenant,role) baseline.
- Group 8 renders the freshness single-stat red when `time() − last_success > 25 h`.
- A15/A16 thresholds + channels match monitoring.md §3; no new monitoring tier introduced.
