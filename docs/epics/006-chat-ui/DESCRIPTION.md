# Epic 006 — Chat workspace UI

The user-facing chat experience: workspace shell, streaming message render, inline
charts with chart↔table toggle (client cache), export, query-inspect drawer, and
the permission-block / clarification / error states.

## Motivation
Covers FR-UI-1..3, FR-LLM-3/4/5, FR-VIZ-1..6, NFR-A11Y-1, NFR-PERF-1, GAP-13
(client cache toggle), GAP-14 (client-side export). UI: S2 Chat Workspace, S3 Query
Inspect Drawer, S9 Permission Block, plus the empty/loading/error states.

## Definition of Done
- Users can ask a question and watch the answer stream; charts render inline with
  the auto-selected type and a chart↔table toggle that re-uses cached data.
- Export (PNG/JPEG/CSV/JSON) works client-side from the cached envelope.
- "View query" opens the inspect drawer for capability-enabled roles.
- Permission-block, clarification, and error states render per UI/UX §11.
- All screens meet WCAG 2.1 AA (axe + the chart→table accessible fallback).

## deps: 001, 002, 005

## Dependency graph & parallelism plan

Wave 1 (parallel): T6.1, T6.3
Wave 2 (parallel): T6.2, T6.4
Wave 3 (parallel): T6.5, T6.6

- T6.1 (workspace shell + sidebar + history) and T6.3 (chart components + a11y)
  parallel — different file areas.
- T6.2 (streaming message render + states) and T6.4 (ChartCard: toggle + export +
  cache) parallel after the shell/charts exist.
- T6.5 (query-inspect drawer S3) and T6.6 (block/clarification/empty/error states S9
  + §11) parallel.

## Risks / open questions
- Client result cache memory cap (GAP-8 row cap) must be respected for large sets.
- GAP-14 export size warning threshold confirmed at 5,000 rows (warn above).
