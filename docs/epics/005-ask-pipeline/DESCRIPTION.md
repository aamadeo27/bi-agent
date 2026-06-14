# Epic 005 — Ask pipeline (agent + permission gate)

The critical path: LLM provider abstraction (Gemini default), context building
(schema metadata only), query generation, the pre-execution permission gate (L1,
block+explain), query validation/injection guard, chart-type selection, SSE
streaming, and conversation history.

## Motivation
Covers FR-LLM-1..6, FR-AC-4/5, NFR-SEC-2/3, NFR-PERF-1, FR-VIZ-1, FR-UI-2/3,
GAP-12 (block+explain), GAP-18 (schema-only to provider), GAP-13 (envelope feeds
client cache). This is the server side of Action A and Action E.

## Definition of Done
- A question flows through: resolve → build context (schema only) → generate →
  **gate (block on any missing resource)** → validate → execute via proxy →
  stream text + result envelope (with auto-selected chart type).
- Provider is swappable by config; Gemini is the default adapter; no SDK leaks
  outside adapters.
- Permission gate is a pure, adversarially-tested module; blocks the whole query
  with an exact `missing[]` list; never subsets; re-runs on every follow-up.
- Conversation history is durable and feeds follow-up context; a scheduled job
  auto-purges conversations older than the 365-day default (GAP-4), alongside manual
  user delete.

## deps: 001, 002, 003, 004

## Dependency graph & parallelism plan

Wave 1 (parallel): T5.1, T5.2, T5.6
Wave 2 (parallel): T5.3, T5.4, T5.8
Wave 3 (serial): T5.5
Wave 4 (parallel): T5.7

- T5.1 (LlmProvider port + Gemini adapter), T5.2 (permission gate, pure), and T5.6
  (conversations module) are independent — parallel.
- T5.3 (query validator/injection guard) and T5.4 (chart-type selection, pure)
  parallel after the port/gate exist. T5.8 (retention purge job) depends only on T5.6
  (conversations module), so it runs in Wave 2 in parallel with T5.3/T5.4.
- T5.5 (ask orchestrator + SSE endpoint) wires T01–T5.4 + the 004 proxy + T5.6 →
  serialize as the integration point.
- T5.7 (query-inspect endpoint) depends on T5.5 producing GeneratedQueryView data.

## Risks / open questions
- Gate must extract resources via AST, never the model's self-report (pitfalls).
- Prompt must carry schema metadata only — no row data (GAP-18).
