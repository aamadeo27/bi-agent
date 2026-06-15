import { z } from "zod";
import { SseBlockEventSchema, type SseBlockEvent } from "./permission-block.js";
import { SseErrorEventSchema, type SseErrorEvent } from "./error-codes.js";

export const ColumnTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
]);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

export const ResultEnvelopeSchema = z.object({
  messageId: z.string(),
  queryType: z.enum(["sql", "rest"]),
  chartType: z.enum(["bar", "line", "pie", "table"]),
  columns: z.array(
    z.object({
      name: z.string(),
      type: ColumnTypeSchema,
      role: z.enum(["dimension", "measure", "time"]),
    })
  ),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  notes: z.string().optional(),
});
export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>;

/** Request body for POST /api/conversations/:conversationId/messages */
export const SendMessageRequestSchema = z.object({
  text: z.string().min(1),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/** Item in GET /api/conversations list */
export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

// SSE event payload schemas

export const SseMetaEventSchema = z.object({
  messageId: z.string(),
  queryType: z.enum(["sql", "rest"]),
});
export type SseMetaEvent = z.infer<typeof SseMetaEventSchema>;

export const SseTokenEventSchema = z.object({
  delta: z.string(),
});
export type SseTokenEvent = z.infer<typeof SseTokenEventSchema>;

export const SseResultEventSchema = z.object({
  envelope: ResultEnvelopeSchema,
});
export type SseResultEvent = z.infer<typeof SseResultEventSchema>;

export const SseDoneEventSchema = z.object({
  messageId: z.string(),
});
export type SseDoneEvent = z.infer<typeof SseDoneEventSchema>;

/**
 * All valid SSE `event:` names for this API.
 * The `satisfies` constraint on SSE_EVENT_SCHEMAS ensures every name has a registered schema.
 */
export type SseEventName =
  | "meta"
  | "token"
  | "result"
  | "block"
  | "error"
  | "done";

export type SseEventDataMap = {
  meta: SseMetaEvent;
  token: SseTokenEvent;
  result: SseResultEvent;
  block: SseBlockEvent;
  error: SseErrorEvent;
  done: SseDoneEvent;
};

// Compile-time check: every SseEventName has exactly one schema in this map.
export const SSE_EVENT_SCHEMAS = {
  meta: SseMetaEventSchema,
  token: SseTokenEventSchema,
  result: SseResultEventSchema,
  block: SseBlockEventSchema,
  error: SseErrorEventSchema,
  done: SseDoneEventSchema,
} satisfies Record<SseEventName, z.ZodTypeAny>;
