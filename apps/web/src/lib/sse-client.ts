// placeholder — T1.4 implements the SSE stream connection
import type { SseEventName, SseEventDataMap } from "@bi/contracts";

export type SseHandler<K extends SseEventName> = (data: SseEventDataMap[K]) => void;

export type SseHandlers = Partial<{ [K in SseEventName]: SseHandler<K> }>;

/** Returns a cleanup/disconnect function. */
export function connectSse(
  _conversationId: string,
  _handlers: SseHandlers,
): () => void {
  throw new Error("Not implemented — see T1.4");
}
