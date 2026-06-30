import { useState } from "react";
import type { ConversationSummary } from "@bi/contracts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Spec: truncate title at 40 chars. */
function truncateTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

// ─── TrashIcon ────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | undefined;
  tenantName: string;
  isLoading: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConversationSidebar({
  conversations,
  activeId,
  tenantName,
  isLoading,
  onNew,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <nav
      aria-label="Conversations"
      className="flex h-full w-60 flex-shrink-0 flex-col border-r border-neutral-300 bg-neutral-50"
    >
      {/* Tenant identity */}
      <div className="flex items-center border-b border-neutral-300 px-4 py-3">
        <span className="truncate text-heading-3 text-primary-700">{tenantName}</span>
      </div>

      {/* New conversation */}
      <div className="px-3 py-3">
        <button
          onClick={onNew}
          className="w-full rounded-md bg-primary px-3 py-2 text-body font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          New conversation
        </button>
      </div>

      {/* Conversation list — status/empty outside the <ul> to satisfy aria-required-children */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-3" role="status" aria-live="polite">
            <p className="text-body-sm text-neutral-500">Loading…</p>
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <p className="px-4 py-3 text-body-sm text-neutral-500">No previous conversations.</p>
        )}

        {!isLoading && conversations.length > 0 && (
          <ul aria-label="Past conversations">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const showDelete = hoveredId === conv.id || isActive;
              const displayTitle = truncateTitle(conv.title || "Untitled conversation");

              return (
                <li
                  key={conv.id}
                  className={`relative flex items-start gap-1 px-2 py-2 transition-colors ${
                    isActive ? "bg-primary-200" : "hover:bg-neutral-100"
                  }`}
                  onMouseEnter={() => setHoveredId(conv.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Select button */}
                  <button
                    onClick={() => onSelect(conv.id)}
                    aria-current={isActive ? "page" : undefined}
                    className="min-w-0 flex-1 rounded-sm px-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                  >
                    <span className="block truncate text-body text-neutral-900">{displayTitle}</span>
                    <span className="block text-body-sm text-neutral-500">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </button>

                  {/* Delete button — revealed on hover/active */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    aria-label={`Delete conversation: ${displayTitle}`}
                    className={`mt-0.5 flex-shrink-0 rounded p-1 text-neutral-500 transition-opacity hover:bg-neutral-200 hover:text-semantic-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
                      showDelete ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                    tabIndex={showDelete ? 0 : -1}
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}

// ─── Exported helpers (for tests) ────────────────────────────────────────────

export { formatRelativeTime, truncateTitle };
