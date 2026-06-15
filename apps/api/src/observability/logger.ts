import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Structured logger (pino) — the API's single logging entrypoint.
 *
 * Bootstrap subset of the full observability plan (`docs/kb/monitoring.md` §5).
 * - Level is read from `LOG_LEVEL` (default `info`).
 * - In development we use the `pino-pretty` transport for human-readable output;
 *   in every other environment we emit newline-delimited JSON (the format Cloud
 *   Logging and any OTLP/log backend expect).
 * - Redaction follows the monitoring privacy rules (monitoring.md §"Standing
 *   label rules" / §5 + devops §6.3): credentials, tokens, secrets, keys are
 *   stripped at the logger so they can never reach a sink. We never log request
 *   bodies, SQL literals, or queried row values (enforced by NOT serializing
 *   them — see `httpLogger` below).
 *
 * TODO(epic-007 / T7.3): this is the bootstrap dev logger only. Full structured
 * fields (`tenantId`, `userId`, `roleName`, trace/`requestId` correlation) and
 * OTel metrics/traces are wired in 007-audit-observability T7.3. Do not expand
 * the metrics/alert catalog here.
 */

const isDevelopment = (process.env["NODE_ENV"] ?? "development") === "development";

/**
 * Keys whose values are redacted wherever they appear in a logged object.
 * Mirrors devops §6.3 / monitoring.md §5. Paths use pino's redact syntax so
 * both top-level and nested occurrences (e.g. inside `req.headers`) are caught.
 */
const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "key",
  "credential",
  "*.password",
  "*.token",
  "*.secret",
  "*.key",
  "*.credential",
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

const baseOptions: LoggerOptions = {
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[redacted]",
  },
};

const options: LoggerOptions = isDevelopment
  ? {
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }
  : baseOptions;

export const logger: Logger = pino(options);

export type { Logger };
