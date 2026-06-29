// Ask pipeline — incrementally implemented across T5.x tasks.
// See: docs/kb/patterns/permission-gate-middleware.md, streaming-sse.md

export {
  evaluateGate,
  type Dialect,
  type GeneratedQuery,
  type ResourceRef,
  type GateResult,
} from "./permission-gate.js";

export {
  selectChartType,
  inferRole,
  countDistinct,
  ROW_CAP,
  type InputColumn,
  type ColumnRole,
  type ScoredColumn,
  type ChartType,
  type ChartSelectionResult,
} from "./select-chart-type.js";

export {
  validateQuery,
  DEFAULT_MAX_QUERY_LENGTH,
  DEFAULT_MAX_ROW_LIMIT,
  type ValidatedQuery,
  type ValidatedSqlQuery,
  type ValidatedRestQuery,
  type ValidatorOptions,
  type ValidationResult,
  type ValidationError,
} from "./query-validator.js";

export {
  runAskPipeline,
  buildSchemaPrompt,
  OrchestratorError,
  type SseSender,
  type OrchestratorArgs,
} from "./orchestrator.js";
