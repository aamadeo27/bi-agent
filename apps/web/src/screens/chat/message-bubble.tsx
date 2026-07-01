interface MessageBubbleProps {
  text: string;
  /** Optional send time shown on hover (e.g. "2:30 PM"). */
  timestamp?: string;
}

/** User message bubble — right-aligned, primary-200 background. */
export function MessageBubble({ text, timestamp }: MessageBubbleProps) {
  return (
    <div className="group flex items-end justify-end gap-2" data-testid="message-bubble">
      {/* Timestamp — revealed on row hover */}
      {timestamp && (
        <span
          className="invisible shrink-0 text-body-sm text-neutral-500 group-hover:visible"
          aria-label={`Sent at ${timestamp}`}
        >
          {timestamp}
        </span>
      )}

      <div className="max-w-[70%] rounded-lg bg-primary-200 px-4 py-3 text-body-lg text-neutral-900">
        {text}
      </div>
    </div>
  );
}
