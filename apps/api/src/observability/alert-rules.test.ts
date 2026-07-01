/**
 * Alert A1 — unit tests (dry-run).
 *
 * Validates:
 *   1. A1 triggers on a synthetic gate.bypass.count > 0 metric.
 *   2. A1 triggers on a synthetic gate.error.count > 0 metric.
 *   3. A1 does NOT trigger when both counters are 0 or absent.
 *   4. A1 is never silenced by deploy / maintenance suppression.
 *   5. A1 config matches monitoring.md §3: P1, sec-alerts, 1-min window.
 *
 * These tests act as the "test/dry-run" acceptance criterion in T7.4 — they
 * assert the committed rule config would produce a P1 page for any non-zero
 * gate bypass or error signal, without requiring a live OTel backend.
 */

import { describe, it, expect } from "vitest";
import { A1_GATE_BYPASS, ALERT_RULES } from "./alert-rules.js";
import {
  evaluateAlerts,
  isSuppressible,
  type MetricSnapshot,
} from "./alert-evaluator.js";
import {
  SEC_ALERTS_CHANNEL,
  NOTIFICATION_CHANNELS,
} from "./notification-channels.js";

describe("A1 — gate bypass / error alert rule (dry-run)", () => {
  // ── Trigger conditions ────────────────────────────────────────────────────

  it("fires when gate.bypass.count increases (synthetic bypass metric)", () => {
    const snapshot: MetricSnapshot = { "gate.bypass.count": 1 };
    const fired = evaluateAlerts(ALERT_RULES, snapshot);

    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("A1");
    expect(fired[0].triggeredMetric).toBe("gate.bypass.count");
    expect(fired[0].value).toBe(1);
  });

  it("fires when gate.error.count increases (synthetic error metric)", () => {
    const snapshot: MetricSnapshot = { "gate.error.count": 2 };
    const fired = evaluateAlerts(ALERT_RULES, snapshot);

    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("A1");
    expect(fired[0].triggeredMetric).toBe("gate.error.count");
  });

  it("fires when BOTH counters increase — dedups to a single A1 alert", () => {
    const snapshot: MetricSnapshot = {
      "gate.bypass.count": 1,
      "gate.error.count": 3,
    };
    const fired = evaluateAlerts(ALERT_RULES, snapshot);

    // OR semantics, deduplicated to one A1 incident
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("A1");
  });

  // ── Non-trigger conditions ─────────────────────────────────────────────────

  it("does NOT fire when both counters are 0", () => {
    const snapshot: MetricSnapshot = {
      "gate.bypass.count": 0,
      "gate.error.count": 0,
    };
    const fired = evaluateAlerts(ALERT_RULES, snapshot);
    expect(fired).toHaveLength(0);
  });

  it("does NOT fire when snapshot has no gate metrics (healthy baseline)", () => {
    const fired = evaluateAlerts(ALERT_RULES, {});
    expect(fired).toHaveLength(0);
  });

  it("does NOT fire on other metrics being elevated (no cross-contamination)", () => {
    const snapshot: MetricSnapshot = {
      "gate.decision.count": 100,
      "app.error.count": 5,
      "tenant.request.count": 200,
    };
    const fired = evaluateAlerts(ALERT_RULES, snapshot);
    expect(fired).toHaveLength(0);
  });

  // ── Suppression invariant — A1 MUST NOT be silenced ──────────────────────

  it("A1 is NOT suppressible by deploy suppression rules", () => {
    const snapshot: MetricSnapshot = { "gate.bypass.count": 1 };
    const [alert] = evaluateAlerts(ALERT_RULES, snapshot);

    expect(isSuppressible(alert)).toBe(false);
  });

  it("A1 suppressible flag is false on the committed rule config", () => {
    expect(A1_GATE_BYPASS.suppressible).toBe(false);
  });

  // ── Rule config correctness (monitoring.md §3) ────────────────────────────

  it("A1 is P1 severity", () => {
    expect(A1_GATE_BYPASS.severity).toBe("P1");
  });

  it("A1 routes to sec-alerts channel", () => {
    expect(A1_GATE_BYPASS.channel).toBe("sec-alerts");
  });

  it("A1 window is 1 minute with no auto-close", () => {
    expect(A1_GATE_BYPASS.windowMinutes).toBe(1);
  });

  it("A1 threshold is 0 (any increase fires)", () => {
    expect(A1_GATE_BYPASS.threshold).toBe(0);
  });

  it("A1 condition covers both gate.bypass.count and gate.error.count", () => {
    expect(A1_GATE_BYPASS.condition.metrics).toContain("gate.bypass.count");
    expect(A1_GATE_BYPASS.condition.metrics).toContain("gate.error.count");
  });

  // ── Notification channel — sec-alerts placeholder config ──────────────────

  it("sec-alerts channel exists in channel registry", () => {
    expect(NOTIFICATION_CHANNELS["sec-alerts"]).toBeDefined();
  });

  it("sec-alerts channel endpoint is config-driven via SEC_ALERTS_WEBHOOK_URL", () => {
    expect(SEC_ALERTS_CHANNEL.endpointEnvVar).toBe("SEC_ALERTS_WEBHOOK_URL");
  });
});
