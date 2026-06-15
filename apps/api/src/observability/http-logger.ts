import { pinoHttp, type Options } from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LevelWithSilent } from "pino";
import { logger } from "./logger.js";

/**
 * HTTP request logging middleware (pino-http).
 *
 * Logs one line per request with method / path / status / latency only.
 * It deliberately does NOT serialize request or response bodies, query
 * parameters with row data, SQL, or secrets (monitoring.md §5 privacy rules) —
 * custom serializers below restrict the `req`/`res` objects to a safe field set,
 * and pino's redaction (logger.ts) covers auth headers / cookies as a backstop.
 *
 * TODO(epic-007 / T7.3): correlate each line with `requestId`/trace id +
 * `tenantId`/`userId`/`roleName` once the tenant + tracing middleware land.
 */
const options: Options = {
  logger,
  // Quieten health-check noise; everything else logs at info, errors at error.
  customLogLevel(_req, res, err): LevelWithSilent {
    if (err !== undefined || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (res.statusCode >= 300) return "silent";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  serializers: {
    // Only method + path. No bodies, no headers, no query row data.
    req(req: IncomingMessage & { method?: string; url?: string }) {
      return { method: req.method, url: req.url };
    },
    // Only status. pino-http appends responseTime (latency) automatically.
    res(res: ServerResponse) {
      return { statusCode: res.statusCode };
    },
  },
};

export const httpLogger = pinoHttp(options);
