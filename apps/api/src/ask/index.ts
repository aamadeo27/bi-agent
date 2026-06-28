// Ask pipeline — incrementally implemented across T5.x tasks.
// See: docs/kb/patterns/permission-gate-middleware.md, streaming-sse.md

export {
  evaluateGate,
  type Dialect,
  type GeneratedQuery,
  type ResourceRef,
  type GateResult,
} from "./permission-gate.js";
