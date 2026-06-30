import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import type { ConversationSummary } from "@bi/contracts";
import { ConversationSidebar, formatRelativeTime, truncateTitle } from "./conversation-sidebar";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-30T12:00:00Z").getTime();

const conversations: ConversationSummary[] = [
  { id: "c1", title: "Sales by region", updatedAt: "2026-06-30T10:00:00Z" },
  { id: "c2", title: "Top products last month", updatedAt: "2026-06-29T12:00:00Z" },
];

function renderSidebar(overrides: Partial<Parameters<typeof ConversationSidebar>[0]> = {}) {
  const props = {
    conversations,
    activeId: undefined,
    tenantName: "Acme Corp",
    isLoading: false,
    onNew: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { ...render(<ConversationSidebar {...props} />), props };
}

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for < 1 minute ago", () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString())).toBe("just now");
  });

  it("returns singular 'minute' for exactly 1 minute", () => {
    expect(formatRelativeTime(new Date(NOW - 60_000).toISOString())).toBe("1 minute ago");
  });

  it("returns plural minutes", () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString())).toBe("5 minutes ago");
  });

  it("returns hours", () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 3600_000).toISOString())).toBe("2 hours ago");
  });

  it("returns days", () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 86400_000).toISOString())).toBe("3 days ago");
  });

  it("returns months", () => {
    const twoMonthsAgo = new Date(NOW - 60 * 86400_000).toISOString();
    expect(formatRelativeTime(twoMonthsAgo)).toBe("2 months ago");
  });

  it("returns years", () => {
    const twoYearsAgo = new Date(NOW - 730 * 86400_000).toISOString();
    expect(formatRelativeTime(twoYearsAgo)).toBe("2 years ago");
  });
});

// ─── truncateTitle ────────────────────────────────────────────────────────────

describe("truncateTitle", () => {
  it("returns title unchanged when ≤ 40 chars", () => {
    expect(truncateTitle("Short title")).toBe("Short title");
    expect(truncateTitle("A".repeat(40))).toBe("A".repeat(40));
  });

  it("truncates at 40 chars and appends ellipsis", () => {
    const long = "A".repeat(50);
    const result = truncateTitle(long);
    expect(result).toBe("A".repeat(40) + "…");
  });
});

// ─── ConversationSidebar render ───────────────────────────────────────────────

describe("ConversationSidebar — basic render", () => {
  it("renders tenant name", () => {
    renderSidebar();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("renders 'New conversation' button", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /new conversation/i })).toBeInTheDocument();
  });

  it("calls onNew when button clicked", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /new conversation/i }));
    expect(props.onNew).toHaveBeenCalledOnce();
  });

  it("renders conversation list items", () => {
    renderSidebar();
    expect(screen.getByText("Sales by region")).toBeInTheDocument();
    expect(screen.getByText("Top products last month")).toBeInTheDocument();
  });

  it("calls onSelect with correct id when list item clicked", () => {
    const { props } = renderSidebar();
    // ^anchor: button name starts with title (includes timestamp); avoids matching
    // the delete button whose aria-label starts with "Delete conversation: ..."
    const btn = screen.getByRole("button", { name: /^Sales by region/i });
    fireEvent.click(btn);
    expect(props.onSelect).toHaveBeenCalledWith("c1");
  });
});

// ─── Active highlight ─────────────────────────────────────────────────────────

describe("ConversationSidebar — active highlight", () => {
  it("marks active conversation with aria-current=page", () => {
    renderSidebar({ activeId: "c1" });
    // ^anchor: matches button whose name starts with title (includes timestamp suffix);
    // avoids matching the delete button ("Delete conversation: Sales by region")
    const activeBtn = screen.getByRole("button", { name: /^Sales by region/i });
    expect(activeBtn).toHaveAttribute("aria-current", "page");
  });

  it("does not mark inactive conversations", () => {
    renderSidebar({ activeId: "c1" });
    const inactiveBtn = screen.getByRole("button", { name: /^Top products last month/i });
    expect(inactiveBtn).not.toHaveAttribute("aria-current");
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("ConversationSidebar — empty state", () => {
  it("shows empty message when conversations list is empty", () => {
    renderSidebar({ conversations: [] });
    expect(screen.getByText(/no previous conversations/i)).toBeInTheDocument();
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("ConversationSidebar — loading state", () => {
  it("shows loading indicator", () => {
    renderSidebar({ isLoading: true, conversations: [] });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

describe("ConversationSidebar — delete", () => {
  it("calls onDelete when delete button clicked on active conversation", () => {
    const { props } = renderSidebar({ activeId: "c1" });
    // Active conversation shows delete button directly
    const deleteBtn = screen.getByRole("button", { name: /delete conversation: sales by region/i });
    fireEvent.click(deleteBtn);
    expect(props.onDelete).toHaveBeenCalledWith("c1");
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ConversationSidebar — axe", () => {
  it("has no critical a11y violations (default state)", async () => {
    const { container } = renderSidebar();
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (loading state)", async () => {
    const { container } = renderSidebar({ isLoading: true, conversations: [] });
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (active conversation)", async () => {
    const { container } = renderSidebar({ activeId: "c1" });
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
