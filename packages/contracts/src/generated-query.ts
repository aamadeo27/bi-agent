import { z } from "zod";

/** Returned by GET /api/messages/:id/query (requires canInspectQuery capability). */
export const GeneratedQueryViewSchema = z.object({
  messageId: z.string(),
  queryType: z.enum(["sql", "rest"]),
  queryText: z.string(),
  dataSourceName: z.string(),
  executedAt: z.string().datetime(),
  rowCount: z.number().int().nonnegative(),
});
export type GeneratedQueryView = z.infer<typeof GeneratedQueryViewSchema>;
