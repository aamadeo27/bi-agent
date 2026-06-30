import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { TopNavBar } from "./top-nav-bar";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderNav(overrides: Partial<Parameters<typeof TopNavBar>[0]> = {}) {
  const props = {
    conversationTitle: "Sales by Region",
    conversationId: "c1",
    onTitleChange: vi.fn(),
    isAdmin: false,
    userName: "Jane Doe",
    onSignOut: vi.fn(),
    onToggleSidebar: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <MemoryRouter>
        <TopNavBar {...props} />
      </MemoryRouter>,
    ),
    props,
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

describe("TopNavBar — render", () => {
  it("renders sidebar toggle button", () => {
    renderNav();
    expect(screen.getByRole("button", { name: /toggle sidebar/i })).toBeInTheDocument();
  });

  it("calls onToggleSidebar when hamburger clicked", () => {
    const { props } = renderNav();
    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(props.onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("renders conversation title", () => {
    renderNav();
    expect(screen.getByText("Sales by Region")).toBeInTheDocument();
  });

  it("renders fallback title when no conversationId", () => {
    renderNav({ conversationId: undefined, conversationTitle: "" });
    expect(screen.getByText("Chat Workspace")).toBeInTheDocument();
  });

  it("shows Admin link for admin users", () => {
    renderNav({ isAdmin: true });
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("hides Admin link for non-admin users", () => {
    renderNav({ isAdmin: false });
    expect(screen.queryByRole("link", { name: /^admin$/i })).not.toBeInTheDocument();
  });

  it("renders user avatar with initials", () => {
    renderNav({ userName: "Jane Doe" });
    // Avatar button with initials JD
    expect(screen.getByRole("button", { name: /user menu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /user menu/i })).toHaveTextContent("JD");
  });

  it("handles single-word user name for initials", () => {
    renderNav({ userName: "Admin" });
    expect(screen.getByRole("button", { name: /user menu/i })).toHaveTextContent("A");
  });
});

// ─── Title editing ────────────────────────────────────────────────────────────

describe("TopNavBar — title editing", () => {
  it("enters edit mode on double-click when conversation active", async () => {
    const user = userEvent.setup();
    renderNav({ conversationId: "c1", conversationTitle: "Sales by Region" });
    const titleBtn = screen.getByRole("button", { name: /conversation: sales by region/i });
    await user.dblClick(titleBtn);
    expect(screen.getByRole("textbox", { name: /conversation title/i })).toBeInTheDocument();
  });

  it("does not enter edit mode when no conversationId", async () => {
    const user = userEvent.setup();
    renderNav({ conversationId: undefined, conversationTitle: "" });
    const titleBtn = screen.getByRole("button", { name: /chat workspace/i });
    await user.dblClick(titleBtn);
    expect(screen.queryByRole("textbox", { name: /conversation title/i })).not.toBeInTheDocument();
  });

  it("calls onTitleChange with new title on Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderNav({ conversationId: "c1", conversationTitle: "Old Title" });
    const titleBtn = screen.getByRole("button", { name: /conversation: old title/i });
    await user.dblClick(titleBtn);
    const input = screen.getByRole("textbox", { name: /conversation title/i });
    await user.clear(input);
    await user.type(input, "New Title");
    await user.keyboard("{Enter}");
    expect(props.onTitleChange).toHaveBeenCalledWith("New Title");
  });

  it("cancels edit on Escape without calling onTitleChange", async () => {
    const user = userEvent.setup();
    const { props } = renderNav({ conversationId: "c1", conversationTitle: "Old Title" });
    const titleBtn = screen.getByRole("button", { name: /conversation: old title/i });
    await user.dblClick(titleBtn);
    const input = screen.getByRole("textbox", { name: /conversation title/i });
    await user.type(input, " appended");
    await user.keyboard("{Escape}");
    expect(props.onTitleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not call onTitleChange when title unchanged", async () => {
    const user = userEvent.setup();
    const { props } = renderNav({ conversationId: "c1", conversationTitle: "Same Title" });
    const titleBtn = screen.getByRole("button", { name: /conversation: same title/i });
    await user.dblClick(titleBtn);
    fireEvent.blur(screen.getByRole("textbox", { name: /conversation title/i }));
    expect(props.onTitleChange).not.toHaveBeenCalled();
  });
});

// ─── User menu ────────────────────────────────────────────────────────────────

describe("TopNavBar — user menu", () => {
  it("opens user menu on click", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: /user menu/i }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /profile/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("calls onSignOut when Sign out clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderNav();
    await user.click(screen.getByRole("button", { name: /user menu/i }));
    await waitFor(() => screen.getByRole("menuitem", { name: /sign out/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("TopNavBar — axe", () => {
  it("has no critical a11y violations", async () => {
    const { container } = renderNav();
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (admin)", async () => {
    const { container } = renderNav({ isAdmin: true });
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
