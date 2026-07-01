import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMe,
  listConversations,
  createConversation,
  deleteConversation,
  logout,
} from "../../lib/api-client";
import { clearAccessToken } from "../../lib/auth-store";
import { ConversationSidebar } from "./conversation-sidebar";
import { TopNavBar } from "./top-nav-bar";
import { InputBar } from "./input-bar";
import { ChatTimeline, type ChatTimelineHandle } from "./chat-timeline";

// ─── Welcome / empty state ────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Show me sales by region last quarter",
  "What were the top products last month?",
  "Compare revenue year over year",
  "Which customers have the highest lifetime value?",
] as const;

function WelcomeState({ onChipClick }: { onChipClick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      {/* Illustration */}
      <div aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-16 w-16 text-primary-200"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      </div>

      <div className="text-center">
        <h1 className="text-heading-1 text-neutral-900">Ask your first question</h1>
        <p className="mt-1 max-w-sm text-body text-neutral-500">
          Type a question below to start exploring your data.
        </p>
      </div>

      {/* Suggestion chips */}
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Example prompts">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              onClick={() => onChipClick(prompt)}
              className="rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-body text-primary-700 transition-colors hover:bg-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── ChatPage ─────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Local title override — cleared when the active conversation changes.
  // Title persistence requires a future PATCH /api/conversations/:id endpoint.
  const [localTitle, setLocalTitle] = useState("");
  // Controlled input value — allows WelcomeState chips to populate the input.
  const [inputText, setInputText] = useState("");
  // Tracks whether an SSE stream is in-flight (disables input bar send button).
  const [isStreaming, setIsStreaming] = useState(false);
  // Ref to the timeline's imperative send() method.
  const timelineRef = useRef<ChatTimelineHandle>(null);

  // Reset local title override whenever the user navigates to a different conversation
  useEffect(() => {
    setLocalTitle("");
  }, [conversationId]);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
    staleTime: 30 * 1000,
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/chat/${conv.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (deletedId === conversationId) {
        navigate("/chat");
      }
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  // Mutation objects change reference each render; useCallback on them is a no-op — use plain functions.
  function handleNew() {
    createMutation.mutate();
  }

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/chat/${id}`);
    },
    [navigate],
  );

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

  function handleSend(text: string) {
    if (!conversationId) {
      // No active conversation — create one first; user re-sends after navigation.
      createMutation.mutate();
      return;
    }
    setInputText("");
    timelineRef.current?.send(text);
  }

  const handleSignOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      clearAccessToken();
      navigate("/login");
    }
  }, [navigate]);

  // ─── Derived state ─────────────────────────────────────────────────────────

  const conversations = conversationsQuery.data ?? [];
  const activeConversation = conversations.find((c) => c.id === conversationId);
  const displayTitle = localTitle || activeConversation?.title || "";

  const me = meQuery.data;
  const isAdmin = me?.capabilities.isAdmin ?? false;
  const canInspectQuery = me?.capabilities.canInspectQuery ?? false;
  const userName = me?.user.displayName ?? "";
  const tenantName = me?.tenant.displayName ?? "";

  // ─── Auth guard ────────────────────────────────────────────────────────────

  if (meQuery.isError) {
    const err = meQuery.error as { code?: string };
    if (err?.code === "AUTH") {
      return <Navigate to="/login?reason=session_expired" replace />;
    }
    return (
      <div className="flex h-screen items-center justify-center bg-white" role="alert">
        <p className="text-body text-neutral-500">
          Failed to load workspace. Please refresh the page.
        </p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          tenantName={tenantName}
          isLoading={conversationsQuery.isPending}
          onNew={handleNew}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />
      )}

      {/* ── Center column ────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNavBar
          conversationTitle={displayTitle}
          conversationId={conversationId}
          onTitleChange={setLocalTitle}
          isAdmin={isAdmin}
          userName={userName}
          onSignOut={handleSignOut}
          onToggleSidebar={() => setSidebarOpen((p) => !p)}
        />

        {/* Chat timeline */}
        <main
          id="chat-main"
          className="flex-1 overflow-hidden"
          aria-label="Chat timeline"
        >
          {!conversationId ? (
            <WelcomeState onChipClick={(text) => setInputText(text)} />
          ) : (
            <ChatTimeline
              ref={timelineRef}
              conversationId={conversationId}
              onStreamingChange={setIsStreaming}
              canInspectQuery={canInspectQuery}
            />
          )}
        </main>

        {/* Sticky input bar */}
        <InputBar
          value={inputText}
          onChange={setInputText}
          onSend={handleSend}
          isStreaming={isStreaming}
        />
      </div>

      {/* ── Right: Query Inspect Drawer (T6.3 slides in here) ─────────────── */}
    </div>
  );
}
