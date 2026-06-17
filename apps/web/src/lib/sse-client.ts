import type { SseEventName, SseEventDataMap, SendMessageRequest } from "@bi/contracts";
import { SSE_EVENT_SCHEMAS } from "@bi/contracts";

export type SseHandler<K extends SseEventName> = (data: SseEventDataMap[K]) => void;
export type SseHandlers = Partial<{ [K in SseEventName]: SseHandler<K> }>;

const BASE = "/api";

/**
 * Submit a message to a conversation and consume the SSE response stream.
 *
 * Uses `fetch` (not `EventSource`) because the endpoint is a POST with an
 * SSE response body — `EventSource` only supports GET.
 *
 * @returns Cleanup function that aborts the in-flight request and stream reader.
 */
export function connectSse(
  conversationId: string,
  messageText: string,
  handlers: SseHandlers,
): () => void {
  const controller = new AbortController();

  void runStream(conversationId, messageText, handlers, controller.signal);

  return () => controller.abort();
}

async function runStream(
  conversationId: string,
  messageText: string,
  handlers: SseHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ text: messageText } satisfies SendMessageRequest),
      signal,
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      handlers.error?.({ code: "INTERNAL", message: "Network error" });
    }
    return;
  }

  if (!res.ok || !res.body) {
    handlers.error?.({ code: "INTERNAL", message: `HTTP ${res.status}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by double newlines
      const blocks = buffer.split("\n\n");
      // Last element may be an incomplete block — keep it in the buffer
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        dispatch(parseBlock(block), handlers);
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      handlers.error?.({ code: "INTERNAL", message: "Stream read error" });
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse one `event:` / `data:` SSE block into a name + raw JSON string. */
function parseBlock(block: string): { name: string; json: string } | null {
  let name = "";
  let json = "";

  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      name = line.slice("event: ".length).trim();
    } else if (line.startsWith("data: ")) {
      json = line.slice("data: ".length);
    }
  }

  return name && json ? { name, json } : null;
}

/** Validate and dispatch a parsed SSE block to the appropriate typed handler. */
function dispatch(
  parsed: { name: string; json: string } | null,
  handlers: SseHandlers,
): void {
  if (!parsed) return;

  const { name, json } = parsed;
  const schema = SSE_EVENT_SCHEMAS[name as SseEventName];
  if (!schema) return;

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return;
  }

  const result = schema.safeParse(payload);
  if (!result.success) return;

  const handler = handlers[name as SseEventName];
  if (handler) {
    // Type-safe dispatch: schema validation above guarantees the shape matches.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handler as (d: unknown) => void)(result.data);
  }
}
