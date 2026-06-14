# Monitoring direction — BI Result Presenter

> Direction only. The `monitor` agent turns this into concrete metrics, queries,
> alert rules, and dashboards. Level: **basic for v1, upgradeable**.

## Tool family
- **OpenTelemetry** for traces + metrics (vendor-neutral; backend chosen later).
- **pino** structured JSON logs, correlated by `requestId`/trace id.

## Must-be-observable signals

### 1. Permission gate (security-critical)
- Count of gate decisions: **allow** vs **block**, by tenant and role.
- For blocks: the kind of missing resource (schema/table/column) — counts only,
  not the data.
- A spike in blocks for a single user/role is a signal (possible probing).

### 2. Query latency
- End-to-end ask latency (submit → first token, submit → result): **p50/p95/p99**.
- Data-source execution time separately (isolate slow sources).
- LLM generation time separately.

### 3. LLM cost / tokens
- Tokens in/out per request and **aggregated per tenant** (cost attribution).
- Provider + model label (so a provider swap is visible).
- Budget signal when a tenant's token usage trends abnormally.

### 4. Error states (taxonomy from contracts `error-codes`)
- Rates of: `GATE_BLOCK`, `VALIDATION`, `DATA_SOURCE`, `LLM_ERROR`, `AUTH`,
  `TENANT`, `INTERNAL`. Distinguish *expected* (block, clarification) from
  *failures* (data-source/LLM/internal).

### 5. Throughput & error rate
- Requests/sec and overall error rate per service; per-tenant request volume.

### 6. Streaming health
- Active SSE streams; client-disconnect / aborted-stream counts (back-pressure
  and leaked-stream signal).

## Standing requirements
- Every span/log carries `tenantId`, `userId`, `roleName`, `requestId` — and
  **never** credentials, tokens, or queried row values.
- Audit events (contracts `audit-event`) are a separate, persisted security record,
  not a substitute for operational metrics.
