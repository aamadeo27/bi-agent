import type { ResultEnvelope } from "@bi/contracts";
import { ChartCard } from "../../components/chart-card";
import { renderMarkdown } from "./markdown-renderer";

interface SystemMessageBubbleProps {
  /** Accumulated text content (may be empty while pending). */
  text: string;
  /** Shows blinking cursor at the end of text while tokens are arriving. */
  isStreaming?: boolean;
  /** When set, renders the ChartCard below the text. */
  envelope?: ResultEnvelope;
  /** Generic error message shown inside the bubble. */
  errorMsg?: string;
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
}: SystemMessageBubbleProps) {
  return (
    <div
      className="flex items-start gap-3"
      data-testid="system-message-bubble"
    >
      {/* Bot avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700"
        aria-hidden="true"
      >
        <span className="text-label text-white">BI</span>
      </div>

      {/* Bubble */}
      <div className="flex w-full max-w-[85%] flex-col gap-3 rounded-lg border border-neutral-300 bg-white px-4 py-3">
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
      </div>
    </div>
  );
}
