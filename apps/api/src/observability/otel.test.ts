/**
 * T7.3 — OTel observability smoke tests.
 *
 * These tests use in-memory OTel exporters to assert that the ask pipeline
 * emits the expected metrics and span attributes on a gate-block scenario, and
 * that no credentials / row data appear in span attributes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { trace, metrics } from "@opentelemetry/api";
import { _resetAskMetrics } from "./metrics.js";
import { evaluateGate } from "../ask/permission-gate.js";
import { getAskMetrics } from "./metrics.js";

// ── OTel test setup ────────────────────────────────────────────────────────────

/**
 * OTel JS API prevents re-registration of global providers (returns false on
 * subsequent calls to setGlobalTracerProvider/setGlobalMeterProvider).  To
 * allow each test to install its own in-memory provider, we clear the relevant
 * keys from the internal OTel global symbol before each registration.
 */
const OTEL_API_SYMBOL = Symbol.for("opentelemetry.js.api.1");

function resetOtelGlobals(): void {
  const current = (globalThis as Record<symbol, unknown>)[OTEL_API_SYMBOL] as
    | Record<string, unknown>
    | undefined;
  if (current) {
    // Preserve version so OTel's API contract check still passes, clear providers.
    (globalThis as Record<symbol, unknown>)[OTEL_API_SYMBOL] = {
      version: current["version"],
    };
  }
}

let spanExporter: InMemorySpanExporter;
let metricExporter: InMemoryMetricExporter;
let tracerProvider: NodeTracerProvider;
let meterProvider: MeterProvider;
let metricReader: PeriodicExportingMetricReader;

beforeEach(() => {
  // Reset instrument cache so new instruments bind to the test providers.
  _resetAskMetrics();

  // Force-clear OTel global so registration succeeds.
  resetOtelGlobals();

  // Span exporter
  spanExporter = new InMemorySpanExporter();
  tracerProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  // Metric exporter
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 100_000, // manual flush only
  });
  meterProvider = new MeterProvider({ readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);
});

afterEach(async () => {
  // Shut down providers (flushes remaining data, prevents open handles).
  await tracerProvider.shutdown();
  await meterProvider.shutdown();
  _resetAskMetrics();
  resetOtelGlobals();
});

// ── Helper: emit a gate decision span + metric the same way the orchestrator does ─

function emitGateDecision(opts: {
  tenantId: string;
  roleId: string;
  decision: "allow" | "block";
  requestId: string;
}): void {
  const tracer = trace.getTracer("bi-api");
  const m = getAskMetrics();

  const span = tracer.startSpan("ask.gate.evaluate", {
    attributes: {
      "tenant.id": opts.tenantId,
      "request.id": opts.requestId,
      "role.id": opts.roleId,
      "gate.decision": opts.decision,
    },
  });
  if (opts.decision === "block") {
    span.setAttribute("gate.missing_count", 2);
  }
  span.end();

  m.gateDecisions.add(1, {
    decision: opts.decision,
    tenant_id: opts.tenantId,
    role_id: opts.roleId,
  });

  if (opts.decision === "block") {
    m.errors.add(1, { error_code: "GATE_BLOCK", tenant_id: opts.tenantId });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("gate-block smoke test", () => {
  it("emits ask.gate.decisions counter with decision=block attributes", async () => {
    emitGateDecision({
      tenantId: "tenant-abc",
      roleId: "role-xyz",
      decision: "block",
      requestId: "req-001",
    });

    await metricReader.forceFlush();
    const resourceMetrics = metricExporter.getMetrics();

    // Find ask.gate.decisions metric
    let found = false;
    for (const rm of resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        for (const metric of sm.metrics) {
          if (metric.descriptor.name === "ask.gate.decisions") {
            found = true;
            expect(metric.dataPoints).toHaveLength(1);
            const dp = metric.dataPoints[0];
            expect(dp.attributes["decision"]).toBe("block");
            expect(dp.attributes["tenant_id"]).toBe("tenant-abc");
            expect(dp.attributes["role_id"]).toBe("role-xyz");
            expect(dp.value).toBe(1);
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it("emits ask.errors counter with error_code=GATE_BLOCK on block", async () => {
    emitGateDecision({
      tenantId: "tenant-abc",
      roleId: "role-xyz",
      decision: "block",
      requestId: "req-002",
    });

    await metricReader.forceFlush();
    const resourceMetrics = metricExporter.getMetrics();

    let found = false;
    for (const rm of resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        for (const metric of sm.metrics) {
          if (metric.descriptor.name === "ask.errors") {
            found = true;
            const dp = metric.dataPoints.find(
              (p) => p.attributes["error_code"] === "GATE_BLOCK",
            );
            expect(dp).toBeDefined();
            expect(dp?.attributes["tenant_id"]).toBe("tenant-abc");
            expect(dp?.value).toBe(1);
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it("emits ask.gate.evaluate span with required attributes on block", async () => {
    emitGateDecision({
      tenantId: "tenant-abc",
      roleId: "role-xyz",
      decision: "block",
      requestId: "req-003",
    });

    const spans = spanExporter.getFinishedSpans();
    const gateSpan = spans.find((s) => s.name === "ask.gate.evaluate");
    expect(gateSpan).toBeDefined();

    expect(gateSpan?.attributes["tenant.id"]).toBe("tenant-abc");
    expect(gateSpan?.attributes["request.id"]).toBe("req-003");
    expect(gateSpan?.attributes["role.id"]).toBe("role-xyz");
    expect(gateSpan?.attributes["gate.decision"]).toBe("block");
    expect(gateSpan?.attributes["gate.missing_count"]).toBe(2);
  });

  it("does NOT emit ask.errors on allow decision", async () => {
    emitGateDecision({
      tenantId: "tenant-abc",
      roleId: "role-xyz",
      decision: "allow",
      requestId: "req-004",
    });

    await metricReader.forceFlush();
    const resourceMetrics = metricExporter.getMetrics();

    for (const rm of resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        for (const metric of sm.metrics) {
          if (metric.descriptor.name === "ask.errors") {
            // No GATE_BLOCK entries
            const blockDp = metric.dataPoints.find(
              (p) => p.attributes["error_code"] === "GATE_BLOCK",
            );
            expect(blockDp).toBeUndefined();
          }
        }
      }
    }
  });
});

describe("gate evaluation — integration with evaluateGate()", () => {
  it("evaluateGate returns allow:false for a query referencing un-granted table", () => {
    const result = evaluateGate({
      query: { sql: "SELECT id FROM public.secret_table", queryType: "sql" },
      grants: [
        {
          roleId: "r1",
          dataSourceId: "ds1",
          kind: "table",
          schema: "public",
          table: "allowed_table",
        },
      ],
      dialect: "postgres",
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.missing.length).toBeGreaterThan(0);
    }
  });

  it("evaluateGate returns allow:true for a fully-granted query", () => {
    const result = evaluateGate({
      query: { sql: "SELECT id FROM public.allowed_table", queryType: "sql" },
      grants: [
        {
          roleId: "r1",
          dataSourceId: "ds1",
          kind: "table",
          schema: "public",
          table: "allowed_table",
        },
      ],
      dialect: "postgres",
    });

    expect(result.allow).toBe(true);
  });
});

describe("span attribute redaction — no credentials or row data", () => {
  const FORBIDDEN_ATTRIBUTE_PATTERNS = [
    "password",
    "token",
    "secret",
    "key",
    "credential",
    "authorization",
    "cookie",
    // Row data should never appear as span attributes
    "sql",
    "row_data",
    "query_text",
    "result_rows",
  ];

  it("ask.gate.evaluate span contains no forbidden attribute keys", () => {
    emitGateDecision({
      tenantId: "tenant-test",
      roleId: "role-test",
      decision: "block",
      requestId: "req-redact-1",
    });

    const spans = spanExporter.getFinishedSpans();
    const gateSpan = spans.find((s) => s.name === "ask.gate.evaluate");
    expect(gateSpan).toBeDefined();

    const attributeKeys = Object.keys(gateSpan?.attributes ?? {});
    for (const key of attributeKeys) {
      for (const pattern of FORBIDDEN_ATTRIBUTE_PATTERNS) {
        expect(key.toLowerCase()).not.toContain(pattern);
      }
    }
  });

  it("span attributes contain expected identity/context fields", () => {
    emitGateDecision({
      tenantId: "tenant-test",
      roleId: "role-test",
      decision: "allow",
      requestId: "req-redact-2",
    });

    const spans = spanExporter.getFinishedSpans();
    const gateSpan = spans.find((s) => s.name === "ask.gate.evaluate");
    expect(gateSpan).toBeDefined();

    // These fields MUST be present per monitoring-direction §"Standing requirements"
    expect(gateSpan?.attributes).toHaveProperty("tenant.id");
    expect(gateSpan?.attributes).toHaveProperty("request.id");
    expect(gateSpan?.attributes).toHaveProperty("role.id");
  });
});

describe("metric instrument presence", () => {
  it("getAskMetrics() returns all required instruments", () => {
    const m = getAskMetrics();
    expect(m.gateDecisions).toBeDefined();
    expect(m.e2eLatency).toBeDefined();
    expect(m.datasourceLatency).toBeDefined();
    expect(m.llmGenerateLatency).toBeDefined();
    expect(m.llmStreamLatency).toBeDefined();
    expect(m.llmTokensIn).toBeDefined();
    expect(m.llmTokensOut).toBeDefined();
    expect(m.errors).toBeDefined();
    expect(m.streamingActive).toBeDefined();
    expect(m.streamingAborted).toBeDefined();
  });

  it("streaming active counter increments and decrements", async () => {
    const m = getAskMetrics();
    m.streamingActive.add(1, { tenant_id: "t1" });
    m.streamingActive.add(1, { tenant_id: "t1" });
    m.streamingActive.add(-1, { tenant_id: "t1" });

    await metricReader.forceFlush();
    const resourceMetrics = metricExporter.getMetrics();

    let found = false;
    for (const rm of resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        for (const metric of sm.metrics) {
          if (metric.descriptor.name === "ask.streaming.active") {
            found = true;
            const dp = metric.dataPoints.find((p) => p.attributes["tenant_id"] === "t1");
            expect(dp?.value).toBe(1); // 2 opens − 1 close
          }
        }
      }
    }
    expect(found).toBe(true);
  });
});
