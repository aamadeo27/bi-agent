import { z } from "zod";
import { AppErrorSchema, type AppError } from "./error-codes.js";
import {
  SSE_EVENT_SCHEMAS,
  type SseEventName,
  type SseEventDataMap,
} from "./chat.js";

/**
 * Parse `data` against `schema`, returning Zod's SafeParseReturnType.
 * Thin wrapper kept for import ergonomics — callers get one import for all validation.
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown
): z.SafeParseReturnType<T, T> {
  return schema.safeParse(data);
}

/**
 * Parse `data` against `schema` and return the value, or throw ZodError.
 * Prefer this at the edge when an invalid payload is a hard failure.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Parse the JSON payload of a named SSE event.
 * The return type is narrowed to the schema for that event name.
 */
export function parseSseEventData<K extends SseEventName>(
  event: K,
  rawJson: unknown
): SseEventDataMap[K] {
  const schema = SSE_EVENT_SCHEMAS[event] as unknown as z.ZodType<SseEventDataMap[K]>;
  return schema.parse(rawJson);
}

/** Parse an API error response into a typed AppError. Throws ZodError on invalid shape. */
export function parseAppError(data: unknown): AppError {
  return AppErrorSchema.parse(data);
}

/** Safe variant — never throws. */
export function safeParseAppError(
  data: unknown
): z.SafeParseReturnType<AppError, AppError> {
  return AppErrorSchema.safeParse(data);
}

/**
 * Format a ZodError into a single human-readable string.
 * Useful for logging validation failures at the edge.
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
      return `${path}${e.message}`;
    })
    .join("; ");
}

/**
 * Exhaustive-switch helper — call in the `default` branch of a switch over a
 * discriminated union.  TypeScript narrows `x` to `never` if all cases are
 * handled; if not, this call is a compile error.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${String(x)}`);
}
