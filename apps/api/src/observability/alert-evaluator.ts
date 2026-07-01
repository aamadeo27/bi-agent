/**
 * Alert evaluator — dry-run engine for the committed alert rules.
 *
 * Evaluates `AlertRule[]` against a `MetricSnapshot` (name → cumulative count
 * increase over the rule's window). This is intentionally backend-agnostic:
 * the same rule definitions are used both in unit tests (synthetic snapshots)
 * and, when T7.3's OTel exporter is wired, by a thin adapter that collects
 * real counter deltas from the OTel MetricReader and passes them here.
 *
 * The metrics backend target is read from `METRICS_BACKEND_URL` (env var) so
 * swapping backends — Cloud Monitoring, Prometheus/Grafana, etc. — requires
 * no change to the rule logic.
 */

import type { AlertRule } from "./alert-rules.js";

/**
 * Metric snapshot passed to the evaluator.
 * Keys are metric names (e.g. "gate.bypass.count").
 * Values are the **increase** observed over the alert rule's window (i.e. a
 * delta, not a cumulative total). A missing key is treated as increase = 0.
 */
export type MetricSnapshot = Record<string, number>;

/** A single fired alert result. */
export interface FiredAlert {
  readonly rule: AlertRule;
  /** Which metric in the rule's OR condition triggered this firing. */
  readonly triggeredMetric: string;
  /** The observed increase value that exceeded the threshold. */
  readonly value: number;
}

/**
 * Evaluate all rules against a metric snapshot.
 *
 * Returns one `FiredAlert` per rule that triggered (at most one per rule, even
 * when multiple metrics in an OR condition are non-zero — first match wins for
 * dedup; the incident team reviews the full snapshot).
 */
export function evaluateAlerts(
  rules: readonly AlertRule[],
  snapshot: MetricSnapshot
): FiredAlert[] {
  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    if (rule.condition.type === "increase_gt") {
      for (const metric of rule.condition.metrics) {
        const value = snapshot[metric] ?? 0;
        if (value > rule.threshold) {
          fired.push({ rule, triggeredMetric: metric, value });
          break; // OR semantics — first match fires; move to next rule
        }
      }
    }
  }

  return fired;
}

/**
 * Returns true when a fired alert is allowed to be suppressed by deploy or
 * maintenance-window suppression rules.
 *
 * A1 (gate bypass) and any other rule with `suppressible: false` MUST NOT
 * be silenced even during a deployment. This function is the single gate for
 * that invariant and is tested directly.
 */
export function isSuppressible(alert: FiredAlert): boolean {
  return alert.rule.suppressible;
}
