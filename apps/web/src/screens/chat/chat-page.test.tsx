import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { MeResponse, ConversationSummary } from "@bi/contracts";
import { getMe, listConversations, createConversation, deleteConversation } from "../../lib/api-client";
import { ChatPage } from "./chat-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  getMe: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../../lib/auth-store", () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => "tok"),
  setAccessToken: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const adminMe: MeResponse = {
  user: { id: "u1", email: "admin@acme.com", displayName: "Admin User", status: "active", authMethods: ["password"] },
  role: { id: "r1", name: "Admin" },
  capabilities: { canInspectQuery: false, isAdmin: true },
  tenant: { id: "t1", displayName: "Acme Corp" },
};

const regularMe: MeResponse = {
  ...adminMe,
  capabilities: { canInspectQuery: false, isAdmin: false },
};

const conversations: ConversationSummary[] = [
  { id: "c1", title: "Sales by region", updatedAt: "2026-06-30T10:00:00Z" },
  { id: "c2", title: "Top products", updatedAt: "2026-06-29T12:00:00Z" },
];

// ─── Render helper ────────────────────────────────────────────────────────────

function renderChat(initialPath = "/chat") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/admin" element={<div>Admin page</div>} />
          <Route path="/account" element={<div>Account page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

describe("ChatPage — layout", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue(conversations);
  });

  it("renders sidebar navigation", async () => {
    renderChat();
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: /conversations/i })).toBeInTheDocument(),
    );
  });

  it("renders header banner", async () => {
    renderChat();
    await waitFor(() =>
      expect(screen.getByRole("banner")).toBeInTheDocument(),
    );
  });

  it("renders main chat area", async () => {
    renderChat();
    await waitFor(() =>
      expect(screen.getByRole("main", { name: /chat timeline/i })).toBeInTheDocument(),
    );
  });

  it("renders input bar", async () => {
    renderChat();
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/ask a question about your data/i)).toBeInTheDocument(),
    );
  });
});

// ─── Welcome state ────────────────────────────────────────────────────────────

describe("ChatPage — welcome state", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue([]);
  });

  it("shows 'Ask your first question' on /chat (no conversation)", async () => {
    renderChat("/chat");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /ask your first question/i })).toBeInTheDocument(),
    );
  });

  it("renders example prompt chips", async () => {
    renderChat("/chat");
    await waitFor(() =>
      expect(screen.getByText(/show me sales by region/i)).toBeInTheDocument(),
    );
  });

  it("fills input bar when chip is clicked", async () => {
    const user = userEvent.setup();
    renderChat("/chat");
    await waitFor(() => screen.getByText(/show me sales by region last quarter/i));
    await user.click(screen.getByText(/show me sales by region last quarter/i));
    const textarea = screen.getByRole("textbox", { name: /message input/i });
    expect(textarea).toHaveValue("Show me sales by region last quarter");
  });
});

// ─── Conversation list ────────────────────────────────────────────────────────

describe("ChatPage — conversation list", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue(conversations);
  });

  it("renders conversations from API", async () => {
    renderChat("/chat");
    await waitFor(() => expect(screen.getByText("Sales by region")).toBeInTheDocument());
    expect(screen.getByText("Top products")).toBeInTheDocument();
  });

  it("shows empty message when no conversations", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    renderChat("/chat");
    await waitFor(() =>
      expect(screen.getByText(/no previous conversations/i)).toBeInTheDocument(),
    );
  });
});

// ─── New conversation ─────────────────────────────────────────────────────────

describe("ChatPage — new conversation", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue(conversations);
    vi.mocked(createConversation).mockResolvedValue({
      id: "c-new",
      title: "New conversation",
      updatedAt: new Date().toISOString(),
    });
  });

  it("calls createConversation when 'New conversation' clicked", async () => {
    const user = userEvent.setup();
    renderChat("/chat");
    await waitFor(() => screen.getByRole("button", { name: /new conversation/i }));
    await user.click(screen.getByRole("button", { name: /new conversation/i }));
    expect(createConversation).toHaveBeenCalledOnce();
  });
});

// ─── Delete conversation ──────────────────────────────────────────────────────

describe("ChatPage — delete conversation", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue(conversations);
    vi.mocked(deleteConversation).mockResolvedValue(undefined);
  });

  it("calls deleteConversation when delete button clicked on active", async () => {
    const user = userEvent.setup();
    renderChat("/chat/c1");
    await waitFor(() => screen.getByRole("button", { name: /delete conversation: sales by region/i }));
    await user.click(screen.getByRole("button", { name: /delete conversation: sales by region/i }));
    // Verify the first argument is the conversation id (TanStack Query may pass additional args internally)
    expect(vi.mocked(deleteConversation).mock.calls[0][0]).toBe("c1");
  });
});

// ─── Admin link ───────────────────────────────────────────────────────────────

describe("ChatPage — admin link", () => {
  it("shows Admin link for admin users", async () => {
    vi.mocked(getMe).mockResolvedValue(adminMe);
    vi.mocked(listConversations).mockResolvedValue([]);
    renderChat("/chat");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument(),
    );
  });

  it("hides Admin link for non-admin users", async () => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue([]);
    renderChat("/chat");
    await waitFor(() => screen.getByRole("navigation", { name: /conversations/i }));
    expect(screen.queryByRole("link", { name: /^admin$/i })).not.toBeInTheDocument();
  });
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("ChatPage — auth guard", () => {
  it("redirects to /login on AUTH error", async () => {
    vi.mocked(getMe).mockRejectedValue({ code: "AUTH", message: "Unauthorized" });
    vi.mocked(listConversations).mockResolvedValue([]);
    renderChat("/chat");
    await waitFor(() =>
      expect(screen.getByText("Login page")).toBeInTheDocument(),
    );
  });
});

// ─── Sidebar toggle ───────────────────────────────────────────────────────────

describe("ChatPage — sidebar toggle", () => {
  it("hides sidebar when hamburger clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue([]);
    renderChat("/chat");
    await waitFor(() => screen.getByRole("navigation", { name: /conversations/i }));
    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(screen.queryByRole("navigation", { name: /conversations/i })).not.toBeInTheDocument();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ChatPage — axe", () => {
  it("has no critical a11y violations (welcome state)", async () => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue([]);
    const { container } = renderChat("/chat");
    await waitFor(() => screen.getByRole("heading", { name: /ask your first question/i }));
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (conversation list)", async () => {
    vi.mocked(getMe).mockResolvedValue(regularMe);
    vi.mocked(listConversations).mockResolvedValue(conversations);
    const { container } = renderChat("/chat/c1");
    // Title appears in both sidebar and nav bar; use getAllByText
    await waitFor(() => screen.getAllByText("Sales by region"));
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
