// TODO: Full schema definition in contracts.md §error-codes
import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "GATE_BLOCK",
  "CLARIFICATION",
  "VALIDATION",
  "DATA_SOURCE",
  "LLM_ERROR",
  "AUTH",
  "TENANT",
  "NOT_FOUND",
  "RATE_LIMIT",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const SseErrorEventSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type SseErrorEvent = z.infer<typeof SseErrorEventSchema>;

export const ApiErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  requestId: z.string().optional(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
