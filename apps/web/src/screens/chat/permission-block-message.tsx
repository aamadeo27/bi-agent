import type { PermissionBlock } from "@bi/contracts";

interface PermissionBlockMessageProps {
  block: PermissionBlock;
}

/**
 * PermissionBlockMessage — shown when the permission gate denies a query.
 * Variant of SystemMessageBubble with semantic-error left border.
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
        {/* Heading row */}
        <div className="flex items-center gap-2">
          <LockIcon className="h-4 w-4 shrink-0 text-semantic-error" aria-hidden="true" />
          <h3 className="text-heading-2 text-semantic-error">Access restricted</h3>
        </div>

        {/* Body */}
        <p className="text-body text-neutral-700">
          Your role <strong>{block.roleName}</strong> does not have permission to access the
          following resources:
        </p>

        {/* Blocked resource list */}
        <ul className="space-y-1" aria-label="Blocked resources">
          {block.missing.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-body-sm">
              <LockIcon className="h-3 w-3 shrink-0 text-semantic-error" aria-hidden="true" />
              <code className="font-mono text-neutral-700">{item.identifier}</code>
              <span className="text-neutral-500">({item.kind})</span>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <p className="text-body-sm text-neutral-500">
          Contact your administrator to request access to these resources.
        </p>
      </div>
    </div>
  );
}

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
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
