# Epic 007 — Audit & observability

Persisted audit log of security-relevant events, the admin Audit Log screen, and
the operational observability hooks (OpenTelemetry traces/metrics + pino) the
`monitor` agent will turn into concrete config.

## Motivation
Covers NFR-AUD-1/2 (GAP-9 confirmed: persisted audit), NFR-OBS-1, and the
monitoring-direction doc. UI: S8 Admin Audit Log (P1).

## Definition of Done
- Security-relevant events (query executed/blocked/validation-failed, export, role/
  permission changes, user-role assigned, data-source changes, login) are persisted
  per the AuditEvent contract — never containing row data or credentials.
- Admins can view/filter/paginate the audit log (S8) and export it as CSV.
- OTel spans/metrics + pino logs emit the monitoring-direction signals (gate
  decisions, latency, LLM tokens/cost, error taxonomy, streaming health), tagged
  with tenant/user/role/requestId, no secrets.
- The **P1 permission-gate bypass/error alert (A1)** from `monitoring.md §3` is
  provisioned as code against the wired backend. (v1 scope = A1 only — user decision.)

> **v1 observability scope (user decision, 2026-06-14):** T01–T7.3 (audit persistence,
> Audit Log UI, OTel/pino instrumentation) + **only the P1 gate-bypass alert A1** (T7.4).
> The full alert set A2–A12 and the 6-panel dashboard (T7.5) are **deferred post-v1**;
> `monitoring.md` is their manual runbook. Recommended fast-follow: A2 (cross-tenant).

## deps: 001, 002, 003, 005

## Dependency graph & parallelism plan

Wave 1 (parallel): T7.1, T7.3
Wave 2 (parallel): T7.2, T7.4

(deferred post-v1: T7.5 dashboard provisioning)

- T7.1 (audit persistence + emit hooks across modules) and T7.3 (OTel/pino
  instrumentation) are independent — parallel.
- T7.2 (S8 Audit Log UI) depends on T7.1's read/query API.
- T7.4 (the single P1 gate-bypass alert A1 as code) depends on T7.3 emitting the
  metrics; realizes `kb/monitoring.md §3 A1`.
- T7.5 (dashboard) is deferred post-v1 and does not run in the v1 waves.

## Risks / open questions
- GAP-9 (persisted audit) confirmed for v1 — events are persisted.
- Retention follows GAP-4 (resolved): audit events are purged on the same 365-day
  default; align the audit purge with the conversation purge job (T5.8) policy.
