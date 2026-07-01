import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ResultEnvelope, PermissionBlock } from "@bi/contracts";
import { connectSse } from "../../lib/sse-client";
import { MessageBubble } from "./message-bubble";
import { StreamingIndicator } from "./streaming-indicator";
import { SystemMessageBubble } from "./system-message-bubble";
import { PermissionBlockMessage } from "./permission-block-message";
import { ClarificationMessage } from "./clarification-message";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChatMessage =
  | {
      kind: "user";
      localId: string;
      text: string;
      timestamp: string;
    }
  | {
      kind: "system";
      localId: string;
      messageId: string | null;
      /**
       * pending        — StreamingIndicator (before first token)
       * streaming      — SystemMessageBubble with cursor
       * complete       — SystemMessageBubble with optional ChartCard
       * blocked        — PermissionBlockMessage
       * clarification  — ClarificationMessage (terminal; streaming already ended)
       * error          — SystemMessageBubble with errorMsg
       */
      status:
        | "pending"
        | "streaming"
        | "complete"
        | "blocked"
        | "clarification"
        | "error";
      text: string;
      timestamp: string;
      envelope?: ResultEnvelope;
      block?: PermissionBlock;
      errorMsg?: string;
    };

// ─── Imperative handle ────────────────────────────────────────────────────────

export interface ChatTimelineHandle {
  /** Submit a user message and start the SSE stream. */
  send: (text: string) => void;
}

// ─── ChatTimeline ─────────────────────────────────────────────────────────────

interface ChatTimelineProps {
  conversationId: string;
  /** Called whenever the streaming state changes (true = in-flight). */
  onStreamingChange?: (streaming: boolean) => void;
}

export const ChatTimeline = forwardRef<ChatTimelineHandle, ChatTimelineProps>(
  function ChatTimeline({ conversationId, onStreamingChange }, ref) {
    const qc = useQueryClient();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const userScrolledRef = useRef(false);
    const [showFab, setShowFab] = useState(false);
    const cleanupRef = useRef<(() => void) | null>(null);
    // Per-instance ID counter — isolated between component instances and test renders.
    const nextIdRef = useRef(0);

    // Reset messages when conversation changes
    useEffect(() => {
      setMessages([]);
      userScrolledRef.current = false;
      setShowFab(false);
    }, [conversationId]);

    // Abort SSE on unmount
    useEffect(() => {
      return () => {
        cleanupRef.current?.();
      };
    }, []);

    // Auto-scroll to bottom when messages update (unless user scrolled up)
    useEffect(() => {
      if (!userScrolledRef.current && scrollRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, [messages]);

    // Track whether the user has scrolled away from the bottom
    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledRef.current = !atBottom;
      setShowFab(!atBottom);
    }, []);

    function scrollToBottom() {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      userScrolledRef.current = false;
      setShowFab(false);
    }

    // ─── send ─────────────────────────────────────────────────────────────────

    const send = useCallback(
      (text: string) => {
        // Abort any prior in-flight stream
        cleanupRef.current?.();

        // Per-instance IDs — not module-level, so test runs stay isolated.
        const userLocalId = `local-${++nextIdRef.current}`;
        const systemLocalId = `local-${++nextIdRef.current}`;
        const timestamp = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        setMessages((prev) => [
          ...prev,
          { kind: "user", localId: userLocalId, text, timestamp },
          {
            kind: "system",
            localId: systemLocalId,
            messageId: null,
            status: "pending",
            text: "",
            timestamp,
          },
        ]);

        onStreamingChange?.(true);

        // Inlined update helper — setMessages is stable, so capturing it is safe.
        const patchSystem = (
          patch: Partial<Extract<ChatMessage, { kind: "system" }>>,
        ) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === "system" && m.localId === systemLocalId
                ? { ...m, ...patch }
                : m,
            ),
          );

        const cleanup = connectSse(conversationId, text, {
          meta: ({ messageId }) => {
            patchSystem({ messageId });
          },

          token: ({ delta }) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "system" && m.localId === systemLocalId
                  ? {
                      ...m,
                      status: m.status === "pending" ? "streaming" : m.status,
                      text: m.text + delta,
                    }
                  : m,
              ),
            );
          },

          result: ({ envelope }) => {
            patchSystem({ status: "complete", envelope, messageId: envelope.messageId });
            // Cache in TanStack Query — backs toggle/export (GAP-13)
            qc.setQueryData(["message-result", envelope.messageId], envelope);
          },

          block: ({ block }) => {
            patchSystem({ status: "blocked", block, messageId: block.messageId });
            onStreamingChange?.(false);
          },

          error: ({ code, message }) => {
            const isClarification = code === "CLARIFICATION";
            patchSystem({
              status: isClarification ? "clarification" : "error",
              ...(isClarification ? {} : { errorMsg: message }),
            });
            onStreamingChange?.(false);
          },

          done: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "system" && m.localId === systemLocalId
                  ? {
                      ...m,
                      status: m.status === "streaming" ? "complete" : m.status,
                    }
                  : m,
              ),
            );
            onStreamingChange?.(false);
          },
        });

        cleanupRef.current = cleanup;
      },
      [conversationId, qc, onStreamingChange],
    );

    // Expose `send` to parent via ref
    useImperativeHandle(ref, () => ({ send }), [send]);

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
      <div className="relative flex h-full flex-col">
        {/* Scrollable message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-6"
          onScroll={handleScroll}
          data-testid="chat-scroll-area"
        >
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-body text-neutral-500">
                No messages yet. Ask a question below.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((msg) => {
                if (msg.kind === "user") {
                  return (
                    <MessageBubble
                      key={msg.localId}
                      text={msg.text}
                      timestamp={msg.timestamp}
                    />
                  );
                }

                // System messages
                switch (msg.status) {
                  case "pending":
                    return <StreamingIndicator key={msg.localId} />;

                  case "streaming":
                    return (
                      <SystemMessageBubble
                        key={msg.localId}
                        text={msg.text}
                        timestamp={msg.timestamp}
                        isStreaming
                      />
                    );

                  case "complete":
                    return (
                      <SystemMessageBubble
                        key={msg.localId}
                        text={msg.text}
                        timestamp={msg.timestamp}
                        {...(msg.envelope ? { envelope: msg.envelope } : {})}
                      />
                    );

                  case "blocked":
                    return msg.block ? (
                      <PermissionBlockMessage
                        key={msg.localId}
                        block={msg.block}
                      />
                    ) : null;

                  case "clarification":
                    // isStreaming omitted — CLARIFICATION is a terminal event;
                    // streaming is always over by the time this state is set.
                    return (
                      <ClarificationMessage
                        key={msg.localId}
                        text={msg.text}
                      />
                    );

                  case "error":
                    return (
                      <SystemMessageBubble
                        key={msg.localId}
                        text={msg.text}
                        timestamp={msg.timestamp}
                        errorMsg={msg.errorMsg ?? "An error occurred."}
                      />
                    );

                  default:
                    return null;
                }
              })}
            </div>
          )}
        </div>

        {/* Scroll-to-bottom FAB — appears when user has scrolled up */}
        {showFab && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-body-sm text-neutral-700 shadow-md hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            aria-label="Scroll to bottom"
            data-testid="scroll-to-bottom-fab"
          >
            <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
            Scroll to bottom
          </button>
        )}
      </div>
    );
  },
);

// ─── Icon ─────────────────────────────────────────────────────────────────────

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
