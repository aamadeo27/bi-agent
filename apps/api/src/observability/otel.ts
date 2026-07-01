/**
 * OpenTelemetry SDK initialisation.
 *
 * Exports are config-driven via env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — when set, enables OTLP/HTTP trace + metric export
 *   OTEL_SERVICE_NAME             — defaults to "bi-api"
 *   OTEL_METRIC_EXPORT_INTERVAL_MS — metric push interval, defaults to 30 000 ms
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is absent (dev default) the global providers
 * remain as the built-in NoOp — zero overhead, no network calls.
 *
 * Usage:
 *   import { initOtel, getTracer, getMeter } from "./observability/otel.js";
 *   initOtel(); // call once at process startup
 *   const span = getTracer().startSpan("my.op");
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { trace, metrics } from "@opentelemetry/api";
import { logger } from "./logger.js";

let sdk: NodeSDK | undefined;

/**
 * Initialise the OTel SDK.  Safe to call multiple times — subsequent calls
 * are no-ops so tests can call it without double-initialisation errors.
 */
export function initOtel(): void {
  if (sdk) return;

  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  const serviceName = process.env["OTEL_SERVICE_NAME"] ?? "bi-api";

  if (!endpoint) {
    logger.debug("OTel: OTEL_EXPORTER_OTLP_ENDPOINT not set — traces/metrics are no-op");
    return;
  }

  const resource = new Resource({ [ATTR_SERVICE_NAME]: serviceName });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  const metricExporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` });
  const exportIntervalMillis = Number(
    process.env["OTEL_METRIC_EXPORT_INTERVAL_MS"] ?? "30000",
  );

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis }),
  });

  sdk.start();
  logger.info({ endpoint, serviceName, exportIntervalMillis }, "OTel: SDK started");

  // Flush + shut down on graceful termination.
  process.once("SIGTERM", () => {
    sdk?.shutdown().catch((err) => logger.error({ err }, "OTel: shutdown error"));
  });
}

/** Shut down the SDK (useful in tests and graceful-exit handlers). */
export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}

/** Returns the global tracer. Name defaults to the service name. */
export function getTracer(name = "bi-api") {
  return trace.getTracer(name);
}

/** Returns the global meter. Name defaults to the service name. */
export function getMeter(name = "bi-api") {
  return metrics.getMeter(name);
}

// Re-export so callers can set custom global providers (used in tests).
export { trace, metrics };
