/**
 * Notification channel placeholders — monitoring.md §3 "Channels".
 *
 * Endpoints are config-driven via environment variables so no rule logic
 * changes are needed when wiring to a real backend (PagerDuty, Slack webhook,
 * Cloud Monitoring notification channel, etc.).
 *
 * To bind a real endpoint set the corresponding env var before startup.
 * Example: SEC_ALERTS_WEBHOOK_URL=https://hooks.slack.com/... (P1 security pager)
 *
 * Channels intentionally NOT wired at bootstrap — the monitor agent wires
 * concrete backend/alerts in T7.4. This file is the committed placeholder so
 * the channel names live in code rather than click-ops.
 */

export type ChannelType =
  | "placeholder" // not yet wired to a real endpoint
  | "webhook"
  | "email"
  | "pagerduty";

export interface NotificationChannel {
  readonly name: string;
  readonly type: ChannelType;
  /**
   * Name of the environment variable that holds the endpoint URL.
   * Unset → channel is a no-op placeholder (alert is still logged).
   */
  readonly endpointEnvVar: string;
  readonly description: string;
}

// ── Channel definitions ───────────────────────────────────────────────────────

/** P1 security pager — A1 (gate bypass/error) and A13 (vault decrypt failure). */
export const SEC_ALERTS_CHANNEL: NotificationChannel = {
  name: "sec-alerts",
  type: "placeholder",
  endpointEnvVar: "SEC_ALERTS_WEBHOOK_URL",
  description:
    "P1 security incidents. Set SEC_ALERTS_WEBHOOK_URL to wire to PagerDuty / Slack #sec-alerts.",
};

/** P1/P2 ops pager — A7 availability, A5 latency SLO, A8 error rate, etc. */
export const OPS_PAGER_CHANNEL: NotificationChannel = {
  name: "ops-pager",
  type: "placeholder",
  endpointEnvVar: "OPS_PAGER_WEBHOOK_URL",
  description:
    "P1/P2 ops incidents. Set OPS_PAGER_WEBHOOK_URL to wire to PagerDuty / Slack #ops-pager.",
};

/** P3 daily digest — trend/anomaly alerts (A6, A11, A12, A16, etc.). */
export const OPS_DIGEST_CHANNEL: NotificationChannel = {
  name: "ops-digest",
  type: "placeholder",
  endpointEnvVar: "OPS_DIGEST_WEBHOOK_URL",
  description:
    "P3 digest. Set OPS_DIGEST_WEBHOOK_URL to wire to Slack #ops-digest.",
};

export const NOTIFICATION_CHANNELS: Record<string, NotificationChannel> = {
  "sec-alerts": SEC_ALERTS_CHANNEL,
  "ops-pager": OPS_PAGER_CHANNEL,
  "ops-digest": OPS_DIGEST_CHANNEL,
};

/**
 * Resolve the live endpoint for a channel from the environment.
 * Returns `undefined` when the env var is unset (channel is placeholder/no-op).
 */
export function resolveChannelEndpoint(
  channelName: string
): string | undefined {
  const ch = NOTIFICATION_CHANNELS[channelName];
  if (!ch) return undefined;
  const url = process.env[ch.endpointEnvVar];
  return url?.trim() || undefined;
}
