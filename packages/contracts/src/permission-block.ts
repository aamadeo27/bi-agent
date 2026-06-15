// TODO: Full schema definition in contracts.md §permission-block
import { z } from "zod";

export const PermissionBlockSchema = z.object({
  messageId: z.string(),
  roleName: z.string(),
  missing: z.array(
    z.object({
      kind: z.enum(["schema", "table", "column"]),
      identifier: z.string(),
      accessNeeded: z.literal("read"),
    })
  ),
});
export type PermissionBlock = z.infer<typeof PermissionBlockSchema>;

export const SseBlockEventSchema = z.object({
  block: PermissionBlockSchema,
});
export type SseBlockEvent = z.infer<typeof SseBlockEventSchema>;
