import { renderMarkdown } from "./markdown-renderer";

interface ClarificationMessageProps {
  /** Streamed clarification text from the LLM (already complete at render time). */
  text: string;
}

/**
 * ClarificationMessage — shown when the LLM cannot interpret the query.
 * Variant of SystemMessageBubble with semantic-warning left border.
 *
 * Note: this component is only rendered after the terminal CLARIFICATION error
 * event, so the stream is always finished by this point — no streaming cursor needed.
 */
export function ClarificationMessage({ text }: ClarificationMessageProps) {
  return (
    <div
      className="flex items-start gap-3"
      data-testid="clarification-message"
    >
      {/* Bot avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700"
        aria-hidden="true"
      >
        <span className="text-label text-white">BI</span>
      </div>

      {/* Bubble — 4px warning left border */}
      <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-lg border border-neutral-300 border-l-4 border-l-semantic-warning bg-white px-4 py-3">
        {/* Heading row */}
        <div className="flex items-center gap-2">
          <QuestionIcon className="h-4 w-4 shrink-0 text-semantic-warning" aria-hidden="true" />
          <h3 className="text-heading-2 text-neutral-900">I need more information</h3>
        </div>

        {/* Body — clarification text */}
        <div className="text-body text-neutral-900">
          {renderMarkdown(text)}
        </div>
      </div>
    </div>
  );
}

function QuestionIcon({ className }: { className?: string }) {
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
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
