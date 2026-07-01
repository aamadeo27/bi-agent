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
  /** Generic error message shown inside the bubble with error styling. */
  errorMsg?: string;
  /**
   * Called when the user clicks "Try again".
   * Only rendered when errorMsg is set.
   */
  onRetry?: () => void;
  /** Optional receive time shown on hover (e.g. "2:30 PM"). */
  timestamp?: string;
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
  onRetry,
  timestamp,
}: SystemMessageBubbleProps) {
  const hasError = Boolean(errorMsg);

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
        <div
          className={[
            "flex flex-col gap-3 rounded-lg border border-neutral-300 bg-white px-4 py-3",
            hasError ? "border-l-4 border-l-semantic-error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          {...(hasError ? { role: "alert" } : {})}
        >
          {/* Error heading (§11: "Something went wrong") */}
          {hasError && (
            <div className="flex items-center gap-2">
              <AlertCircleIcon
                className="h-4 w-4 shrink-0 text-semantic-error"
                aria-hidden="true"
              />
              <h3 className="text-heading-2 text-semantic-error">Something went wrong</h3>
            </div>
          )}

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

          {/* Error body + Try again */}
          {errorMsg && (
            <div className="flex flex-col gap-2">
              <p
                className="text-body text-neutral-700"
                data-testid="error-message"
              >
                {errorMsg}
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="w-fit rounded border border-semantic-error px-3 py-1 text-body-sm text-semantic-error transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-semantic-error"
                  data-testid="try-again-button"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          {/* Chart card — rendered when result envelope is available */}
          {envelope && <ChartCard envelope={envelope} />}
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
    </div>
  );
}

function AlertCircleIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
