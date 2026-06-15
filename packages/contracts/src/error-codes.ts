import { z } from "zod";
import { PermissionBlockSchema } from "./permission-block.js";

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

/** SSE `event: error` payload — terminal error event on the stream. */
export const SseErrorEventSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type SseErrorEvent = z.infer<typeof SseErrorEventSchema>;

/** Generic API error body returned outside SSE (4xx/5xx JSON responses). */
export const ApiErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  requestId: z.string().optional(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/**
 * Discriminated union of all application errors.
 * GATE_BLOCK carries the PermissionBlock; CLARIFICATION carries the text.
 * All other codes carry only a message.
 */
export const AppErrorSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("GATE_BLOCK"),
    message: z.string(),
    block: PermissionBlockSchema,
  }),
  z.object({
    code: z.literal("CLARIFICATION"),
    message: z.string(),
    text: z.string(),
  }),
  z.object({ code: z.literal("VALIDATION"), message: z.string() }),
  z.object({ code: z.literal("DATA_SOURCE"), message: z.string() }),
  z.object({ code: z.literal("LLM_ERROR"), message: z.string() }),
  z.object({ code: z.literal("AUTH"), message: z.string() }),
  z.object({ code: z.literal("TENANT"), message: z.string() }),
  z.object({ code: z.literal("NOT_FOUND"), message: z.string() }),
  z.object({ code: z.literal("RATE_LIMIT"), message: z.string() }),
  z.object({ code: z.literal("INTERNAL"), message: z.string() }),
]);
export type AppError = z.infer<typeof AppErrorSchema>;

// Compile-time check: every ErrorCode must appear in AppError and vice versa.
export type AssertErrorCodesExhaustive = [ErrorCode] extends [AppError["code"]]
  ? [AppError["code"]] extends [ErrorCode]
    ? true
    : never
  : never;
export const _assertErrorCodesExhaustive: AssertErrorCodesExhaustive = true;
