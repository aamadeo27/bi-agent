/**
 * Metric instrument definitions for the ask pipeline.
 *
 * All instruments are created lazily on first call to getAskMetrics() so that
 * the OTel SDK (and custom test providers) can be registered BEFORE instruments
 * are bound.  The singleton is reset by _resetAskMetrics() in test teardowns.
 *
 * Signals emitted (see monitoring-direction.md):
 *   §1  ask.gate.decisions     — allow/block counts by tenant + role
 *   §2  ask.e2e.duration       — end-to-end ask latency (ms)
 *       ask.datasource.duration — data-source execution latency (ms)
 *       ask.llm.generate.duration — LLM generate-query latency (ms)
 *       ask.llm.stream.duration — LLM stream-narration latency (ms)
 *   §3  ask.llm.tokens.input/output — token counts per request
 *   §4  ask.errors             — error-code taxonomy counts
 *   §5  (throughput via http-logger + OTel auto-instrumentation)
 *   §6  ask.streaming.active   — live SSE stream gauge
 *       ask.streaming.aborted  — disconnected stream count
 */

import type { Counter, Histogram, UpDownCounter } from "@opentelemetry/api";
import { getMeter } from "./otel.js";

export interface AskMetrics {
  /**
   * Gate decisions (allow / block).
   * Attributes: decision ("allow"|"block"), tenant_id, role_id
   */
  gateDecisions: Counter;

  /**
   * End-to-end ask pipeline latency.
   * Attributes: tenant_id
   */
  e2eLatency: Histogram;

  /**
   * Data-source query execution latency.
   * Attributes: tenant_id, datasource_id
   */
  datasourceLatency: Histogram;

  /**
   * LLM generateQuery latency.
   * Attributes: tenant_id, provider, model
   */
  llmGenerateLatency: Histogram;

  /**
   * LLM stream-narration latency (first token to last token).
   * Attributes: tenant_id, provider, model
   */
  llmStreamLatency: Histogram;

  /**
   * LLM input (prompt) tokens consumed per request.
   * Attributes: tenant_id, provider, model
   */
  llmTokensIn: Counter;

  /**
   * LLM output (completion) tokens generated per request.
   * Attributes: tenant_id, provider, model
   */
  llmTokensOut: Counter;

  /**
   * Pipeline error counts by error code (monitoring-direction §4 taxonomy).
   * Attributes: error_code, tenant_id
   */
  errors: Counter;

  /**
   * Currently active SSE streams (up when stream opens, down when it closes).
   * Attributes: tenant_id
   */
  streamingActive: UpDownCounter;

  /**
   * SSE streams that ended due to a client disconnect before completion.
   * Attributes: tenant_id
   */
  streamingAborted: Counter;
}

let _instruments: AskMetrics | undefined;

/**
 * Returns shared metric instrument instances.
 * Creates them on first call — call after OTel is initialised.
 */
export function getAskMetrics(): AskMetrics {
  if (_instruments) return _instruments;

  const meter = getMeter("bi-api.ask");

  _instruments = {
    gateDecisions: meter.createCounter("ask.gate.decisions", {
      description: "Count of permission-gate decisions (allow/block) per tenant and role",
    }),

    e2eLatency: meter.createHistogram("ask.e2e.duration", {
      description: "End-to-end ask pipeline latency in milliseconds",
      unit: "ms",
    }),

    datasourceLatency: meter.createHistogram("ask.datasource.duration", {
      description: "Data-source query execution latency in milliseconds",
      unit: "ms",
    }),

    llmGenerateLatency: meter.createHistogram("ask.llm.generate.duration", {
      description: "LLM query-generation latency in milliseconds",
      unit: "ms",
    }),

    llmStreamLatency: meter.createHistogram("ask.llm.stream.duration", {
      description: "LLM narration-stream latency in milliseconds",
      unit: "ms",
    }),

    llmTokensIn: meter.createCounter("ask.llm.tokens.input", {
      description: "LLM input (prompt) token count per request",
    }),

    llmTokensOut: meter.createCounter("ask.llm.tokens.output", {
      description: "LLM output (completion) token count per request",
    }),

    errors: meter.createCounter("ask.errors", {
      description: "Count of ask pipeline errors by error code",
    }),

    streamingActive: meter.createUpDownCounter("ask.streaming.active", {
      description: "Number of currently active SSE streams",
    }),

    streamingAborted: meter.createCounter("ask.streaming.aborted", {
      description: "Count of SSE streams aborted by client disconnect before completion",
    }),
  };

  return _instruments;
}

/**
 * Reset the instrument cache.
 * Call in test beforeEach/afterEach when using custom OTel test providers.
 */
export function _resetAskMetrics(): void {
  _instruments = undefined;
}
