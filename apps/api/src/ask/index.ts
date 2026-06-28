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
