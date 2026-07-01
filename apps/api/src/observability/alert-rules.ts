/**
 * Alert rules — committed config for monitoring.md §3 alerts.
 *
 * v1 scope: A1 only (gate bypass/error, P1, never suppressed).
 * A2–A16 remain in monitoring.md as a manual runbook; wire them here post-v1.
 *
 * Backend target is config-driven via `METRICS_BACKEND_URL` (set per environment)
 * so the rule logic never needs to change when the metrics backend is swapped.
 *
 * @see docs/kb/monitoring.md §3
 */

/** An "increase > threshold over window" condition on one or more metrics (OR). */
export interface IncreaseGtCondition {
  readonly type: "increase_gt";
  /**
   * Metric names evaluated with OR semantics: the alert fires when
   * increase(any metric in list, windowMinutes) > threshold.
   */
  readonly metrics: readonly string[];
}

export type AlertCondition = IncreaseGtCondition;

export interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly condition: AlertCondition;
  /** Alert fires when metric increase > threshold (0 = any non-zero). */
  readonly threshold: number;
  readonly windowMinutes: number;
  readonly severity: "P1" | "P2" | "P3";
  /** Notification channel name — resolved in notification-channels.ts. */
  readonly channel: string;
  /**
   * Whether this alert may be silenced by deploy or maintenance-window suppression.
   *
   * A1 (gate bypass/error) and A13 (vault decrypt failure) are NEVER suppressible
   * per monitoring.md §3 "Suppression / dedup" — a security-control failure during
   * a deploy is still an incident and requires explicit audited override.
   */
  readonly suppressible: boolean;
  readonly description: string;
}

// ── Alert A1 ──────────────────────────────────────────────────────────────────

/**
 * A1 — Permission-gate bypass or error (P1, never suppressed).
 *
 * Fires on any increase in `gate.bypass.count` OR `gate.error.count`.
 * In a correct system both counters are permanently 0.
 * Any non-zero value is a security-control failure: treat as incident.
 *
 * Condition:  increase(gate.bypass.count[1m]) > 0
 *             OR increase(gate.error.count[1m]) > 0
 * Threshold:  any (> 0)
 * Window:     1 minute — no recovery auto-close
 * Severity:   P1 — page #sec-alerts immediately
 * Suppression: NEVER (see `suppressible: false`)
 *
 * Action: capture requestId/trace, confirm L2 credential still blocked execution,
 *         freeze affected role if needed.
 *
 * @see docs/kb/monitoring.md §3 table row A1
 */
export const A1_GATE_BYPASS: AlertRule = {
  id: "A1",
  name: "Permission-gate bypass or error",
  condition: {
    type: "increase_gt",
    // OR: fires if either counter increases.
    metrics: ["gate.bypass.count", "gate.error.count"],
  },
  threshold: 0,
  windowMinutes: 1,
  severity: "P1",
  channel: "sec-alerts",
  suppressible: false,
  description:
    "L1 allowed an ungranted resource, L2 executed a query the gate did not approve," +
    " or the gate failed to evaluate. Security-control failure. " +
    "Never silenced by deploy or maintenance suppression.",
};

/**
 * All v1 alert rules in evaluation order.
 * A1 is the only rule committed for v1 (user scope decision).
 * Extend this list post-v1 as A2–A16 are wired.
 */
export const ALERT_RULES: readonly AlertRule[] = [A1_GATE_BYPASS] as const;
