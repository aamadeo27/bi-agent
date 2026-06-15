import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import type { ApiErrorResponse } from "@bi/contracts";
import { logger } from "./logger.js";
import { captureError } from "./error-sink.js";

/**
 * Express error-handling middleware (must be registered LAST).
 *
 * - Logs the error via pino (full detail server-side, including stack).
 * - Forwards it to the error sink when one is enabled (no-op otherwise).
 * - Returns a safe JSON error shape to the client: no stack, no internal
 *   message leakage. Shape matches ApiErrorResponse from @bi/contracts.
 *
 * TODO(epic-007 / T7.3): map onto the full error-codes taxonomy
 * (GATE_BLOCK / VALIDATION / DATA_SOURCE / LLM_ERROR / ...) and emit
 * `app.error.count{error_code,class}` (monitoring.md §1.4).
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  // If headers are already sent, defer to Express's default handler.
  if (res.headersSent) {
    next(err);
    return;
  }

  logger.error({ err }, "unhandled request error");
  captureError(err);

  const body: ApiErrorResponse = {
    code: "INTERNAL",
    message: "Internal server error",
  };
  res.status(500).json(body);
};
