import { useState } from "react";
import type { ResultEnvelope } from "@bi/contracts";
import { ChartCard } from "../../components/chart-card";
import { renderMarkdown } from "./markdown-renderer";
import { QueryInspectDrawer } from "./query-inspect-drawer";

interface SystemMessageBubbleProps {
  /** Accumulated text content (may be empty while pending). */
  text: string;
  /** Shows blinking cursor at the end of text while tokens are arriving. */
  isStreaming?: boolean;
  /** When set, renders the ChartCard below the text. */
  envelope?: ResultEnvelope;
  /** Generic error message shown inside the bubble. */
  errorMsg?: string;
  /** Optional receive time shown on hover (e.g. "2:30 PM"). */
  timestamp?: string;
  /** Server-assigned message ID — enables "View query" when combined with canInspectQuery. */
  messageId?: string | null;
  /** Capability flag from /me — shows "View query" button when true. */
  canInspectQuery?: boolean;
}

/**
 * SystemMessageBubble — left-aligned assistant response card.
 * Handles streaming (cursor), completed text (markdown), and ChartCard.
 */
export function SystemMessageBubble({
  text,
  isStreaming = false,
  envelope,
  errorMsg,
  timestamp,
  messageId,
  canInspectQuery = false,
}: SystemMessageBubbleProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      className="group flex items-start gap-3"
      data-testid="system-message-bubble"
    >
      {/* Bot avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700"
        aria-hidden="true"
      >
        <span className="text-label text-white">BI</span>
      </div>

      {/* Bubble + timestamp */}
      <div className="flex w-full max-w-[85%] flex-col gap-1">
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-300 bg-white px-4 py-3">
          {/* Text content */}
          {(text || isStreaming) && (
            <div className="text-body-lg text-neutral-900">
              {renderMarkdown(text)}
              {isStreaming && (
                <span
                  className="ml-0.5 inline-block h-4 w-0.5 animate-blink bg-neutral-900"
                  aria-hidden="true"
                />
              )}
            </div>
          )}

          {/* Error message */}
          {errorMsg && (
            <p
              className="text-body-sm text-semantic-error"
              role="alert"
              data-testid="error-message"
            >
              {errorMsg}
            </p>
          )}

          {/* Chart card — rendered when result envelope is available */}
          {envelope && <ChartCard envelope={envelope} />}

          {/* View query button — capability-gated */}
          {canInspectQuery && messageId && (
            <div className="flex justify-end border-t border-neutral-100 pt-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="text-body-sm text-primary-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                data-testid="view-query-button"
              >
                View query
              </button>
            </div>
          )}
        </div>

        {/* Timestamp — revealed on row hover */}
        {timestamp && (
          <span
            className="invisible text-body-sm text-neutral-500 group-hover:visible"
            aria-label={`Received at ${timestamp}`}
          >
            {timestamp}
          </span>
        )}
      </div>

      {/* Query inspect drawer — portal renders it outside this subtree */}
      {canInspectQuery && messageId && (
        <QueryInspectDrawer
          messageId={messageId}
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
