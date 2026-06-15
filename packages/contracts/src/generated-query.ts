// TODO: Full schema definition in contracts.md §generated-query-view
import { z } from "zod";

export const GeneratedQueryViewSchema = z.object({
  messageId: z.string(),
  queryType: z.enum(["sql", "rest"]),
  queryText: z.string(),
  dataSourceName: z.string(),
  executedAt: z.string().datetime(),
  rowCount: z.number().int().nonnegative(),
});
export type GeneratedQueryView = z.infer<typeof GeneratedQueryViewSchema>;
