// TODO: Full schema definition in contracts.md §chat-api and §result-envelope
import { z } from "zod";

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
