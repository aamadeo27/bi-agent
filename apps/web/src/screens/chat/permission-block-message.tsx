import type { PermissionBlock } from "@bi/contracts";

interface PermissionBlockMessageProps {
  block: PermissionBlock;
}

/**
 * PermissionBlockMessage — shown when the permission gate denies a query (Flow 6).
 * Variant of SystemMessageBubble with semantic-error left border.
 * No chart/table rendered; input remains active.
 */
export function PermissionBlockMessage({ block }: PermissionBlockMessageProps) {
  return (
    <div
      className="flex items-start gap-3"
      data-testid="permission-block-message"
    >
      {/* Bot avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700"
        aria-hidden="true"
      >
        <span className="text-label text-white">BI</span>
      </div>

      {/* Bubble — 4px error left border */}
      <div
        className="flex w-full max-w-[85%] flex-col gap-2 rounded-lg border border-neutral-300 border-l-4 border-l-semantic-error bg-white px-4 py-3"
        role="alert"
      >
        {/* Heading row: shield-with-x icon + text */}
        <div className="flex items-center gap-2">
          <ShieldXIcon className="h-5 w-5 shrink-0 text-semantic-error" />
          <h3 className="text-heading-2 text-semantic-error">Access restricted</h3>
        </div>

        {/* Body — exact wording from Flow 6 */}
        <p className="text-body-lg text-neutral-700">
          Your current role (<strong>{block.roleName}</strong>) does not have access to the
          following resources required to answer this question:
        </p>

        {/* Blocked resource list: kind label + lock icon + monospace identifier + access label */}
        <ul className="space-y-1.5" aria-label="Blocked resources">
          {block.missing.map((item) => (
            <li key={item.identifier} className="flex items-center gap-2 text-body-sm text-neutral-700">
              <LockIcon className="h-3.5 w-3.5 shrink-0 text-semantic-error" />
              <span className="capitalize text-neutral-500">{item.kind}:</span>
              <code className="font-mono text-neutral-900">{item.identifier}</code>
              <span className="text-neutral-500">— Access needed: {item.accessNeeded}</span>
            </li>
          ))}
        </ul>

        {/* Footer suggestion */}
        <p className="text-body-sm text-neutral-500">
          Contact your administrator to request access, or try rephrasing your question to use
          data you have access to.
        </p>
      </div>
    </div>
  );
}

/** Shield with an X mark — semantic-error heading icon (Flow 6). */
function ShieldXIcon({ className }: { className?: string }) {
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
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

/** Padlock — used per-resource in the blocked list. */
function LockIcon({ className }: { className?: string }) {
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
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
