import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

/**
 * Error-tracking sink (free/dev tier) — captures unhandled errors.
 *
 * Bootstrap subset of `docs/kb/monitoring.md`. The provider (Sentry, free tier)
 * is initialized ONLY when `SENTRY_DSN` is present. With no DSN — the default in
 * dev/bootstrap — every export below is a graceful no-op and errors are still
 * surfaced through pino. No crash, no network calls, no production alerting.
 *
 * Privacy: we intentionally do NOT enable Sentry's request-body / data capture
 * (`sendDefaultPii` stays false). Per monitoring.md §"Standing label rules" we
 * never ship credentials, tokens, SQL literals, or row values to the sink.
 *
 * TODO(epic-007 / T7.3 + T7.4): production alerting, release/deploy markers,
 * environment routing, and the full alert catalog (A1 gate-bypass, etc.) are
 * owned by 007-audit-observability. This file is the dev-only capture hook only.
 */

let enabled = false;

/**
 * Initialize the error sink. Safe to call once at process startup.
 * @returns `true` if a sink was activated (DSN present), `false` if no-op.
 */
export function initErrorSink(): boolean {
  const dsn = process.env["SENTRY_DSN"];
  if (dsn === undefined || dsn.trim() === "") {
    logger.debug("error sink disabled: no SENTRY_DSN set (dev/bootstrap default)");
    enabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "development",
    // Dev-only hook: keep tracing off here; full traces are epic-007 (T7.3).
    tracesSampleRate: 0,
    // Never ship PII / request bodies to the sink (monitoring privacy rules).
    sendDefaultPii: false,
  });
  enabled = true;
  logger.info("error sink enabled: Sentry initialized");
  return true;
}

/** Whether a real sink is active. Used by the error middleware to decide whether to forward. */
export function isErrorSinkEnabled(): boolean {
  return enabled;
}

/**
 * Forward an error to the sink. No-op when the sink is disabled, so callers can
 * call this unconditionally.
 */
export function captureError(err: unknown): void {
  if (!enabled) return;
  Sentry.captureException(err);
}
