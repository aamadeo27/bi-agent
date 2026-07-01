/**
 * StreamingIndicator — shown between question submission and first token.
 * Three animated dots + "Thinking..." text, left-aligned like a system bubble.
 */
export function StreamingIndicator() {
  return (
    <div
      className="flex items-center gap-3"
      role="status"
      aria-label="Waiting for response"
      data-testid="streaming-indicator"
    >
      {/* Bot avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700"
        aria-hidden="true"
      >
        <span className="text-label text-white">BI</span>
      </div>

      {/* Dots + label */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1" aria-hidden="true">
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-accent-500"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-accent-500"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-accent-500"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        <span className="text-body-sm text-neutral-500">Thinking...</span>
      </div>
    </div>
  );
}
