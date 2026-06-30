import { useRef, useEffect, type KeyboardEvent } from "react";

// Max visible rows before textarea scrolls internally (spec: 6 lines)
const MAX_TEXTAREA_HEIGHT = 144; // ~6 lines × 24px line-height

// ─── Icons ───────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3.105 2.288a.75.75 0 00-.826.95l1.414 4.926A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.897 28.897 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.288z" />
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InputBarProps {
  /** Controlled text value. */
  value: string;
  onChange: (text: string) => void;
  /** Called when the user submits non-empty text. */
  onSend: (text: string) => void;
  /** While true: send button is disabled; textarea still accepts input. */
  isStreaming?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InputBar({ value, onChange, onSend, isStreaming = false }: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-expand height whenever value changes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter without Shift → send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter → newline (default textarea behaviour)
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
  }

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className="flex-shrink-0 border-t border-neutral-300 bg-white px-4 py-3">
      <div className="flex items-end gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask a question about your data..."
          aria-label="Message input"
          className="flex-1 resize-none bg-transparent text-body text-neutral-900 placeholder:text-neutral-500 focus:outline-none disabled:opacity-60"
          style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px`, overflowY: "auto" }}
        />

        <button
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-body font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <SendIcon />
          <span>Send</span>
        </button>
      </div>

      {isStreaming && (
        <p className="mt-1 text-body-sm text-neutral-500" role="status" aria-live="polite">
          Waiting for response…
        </p>
      )}
    </div>
  );
}
