import { useState, useRef, useEffect } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "react-router-dom";

// ─── Icons ───────────────────────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TopNavBarProps {
  /** Current conversation title. Empty string when no conversation selected. */
  conversationTitle: string;
  /** Defined when a conversation is active; undefined on /chat landing. */
  conversationId: string | undefined;
  /** Called when the user commits an inline title edit. */
  onTitleChange: (newTitle: string) => void;
  isAdmin: boolean;
  userName: string;
  onSignOut: () => void;
  onToggleSidebar: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TopNavBar({
  conversationTitle,
  conversationId,
  onTitleChange,
  isAdmin,
  userName,
  onSignOut,
  onToggleSidebar,
}: TopNavBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversationTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when active conversation changes or title updates from outside
  useEffect(() => {
    setDraft(conversationTitle);
  }, [conversationTitle]);

  // Focus + select all when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEditing() {
    if (!conversationId) return;
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== conversationTitle) {
      onTitleChange(trimmed);
    } else {
      setDraft(conversationTitle);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setDraft(conversationTitle);
    setEditing(false);
  }

  // Avatar initials from display name
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  return (
    <header
      className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-neutral-300 bg-white px-4"
      role="banner"
    >
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="rounded p-1.5 text-neutral-700 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        <HamburgerIcon />
      </button>

      {/* Editable conversation title — centered */}
      <div className="flex flex-1 justify-center">
        {editing && conversationId ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            aria-label="Conversation title"
            className="w-full max-w-sm rounded border border-primary-500 px-2 py-1 text-center text-heading-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        ) : (
          <button
            onDoubleClick={startEditing}
            title={conversationId ? "Double-click to rename" : undefined}
            aria-label={conversationId ? `Conversation: ${conversationTitle || "Untitled"}` : "Chat Workspace"}
            className="max-w-sm truncate rounded px-2 py-1 text-heading-3 text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:cursor-default"
            disabled={!conversationId}
          >
            {conversationTitle || "Chat Workspace"}
          </button>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Link
            to="/admin"
            className="rounded px-3 py-1.5 text-body font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            Admin
          </Link>
        )}

        {/* User menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`User menu — ${userName}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white text-label font-semibold transition-colors hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {initials}
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-[10rem] rounded-md border border-neutral-300 bg-white py-1 shadow-lg"
            >
              {/* Name header */}
              <div className="border-b border-neutral-300 px-3 py-2">
                <p className="text-body-sm font-semibold text-neutral-900">{userName}</p>
              </div>

              <DropdownMenu.Item asChild>
                <Link
                  to="/account"
                  className="flex cursor-pointer items-center px-3 py-2 text-body text-neutral-700 outline-none hover:bg-neutral-100 focus:bg-neutral-100"
                >
                  Profile
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onSelect={onSignOut}
                className="flex cursor-pointer items-center px-3 py-2 text-body text-neutral-700 outline-none hover:bg-neutral-100 focus:bg-neutral-100"
              >
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
