import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { InputBar } from "./input-bar";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderInput(overrides: Partial<Parameters<typeof InputBar>[0]> = {}) {
  const props = {
    value: "",
    onChange: vi.fn(),
    onSend: vi.fn(),
    isStreaming: false,
    ...overrides,
  };
  return { ...render(<InputBar {...props} />), props };
}

// ─── Render ───────────────────────────────────────────────────────────────────

describe("InputBar — render", () => {
  it("renders textarea with placeholder", () => {
    renderInput();
    expect(
      screen.getByPlaceholderText(/ask a question about your data/i),
    ).toBeInTheDocument();
  });

  it("renders send button", () => {
    renderInput();
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
  });
});

// ─── Send enabled / disabled ──────────────────────────────────────────────────

describe("InputBar — send button state", () => {
  it("send button is disabled when value is empty", () => {
    renderInput({ value: "" });
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("send button is disabled when value is only whitespace", () => {
    renderInput({ value: "   " });
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("send button is enabled when value has text", () => {
    renderInput({ value: "Show me sales" });
    expect(screen.getByRole("button", { name: /send message/i })).not.toBeDisabled();
  });

  it("send button is disabled while streaming even with text", () => {
    renderInput({ value: "Some text", isStreaming: true });
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });
});

// ─── onChange ─────────────────────────────────────────────────────────────────

describe("InputBar — onChange", () => {
  it("calls onChange when textarea value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderInput({ onChange });
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "h");
    expect(onChange).toHaveBeenCalled();
  });
});

// ─── Send via button click ────────────────────────────────────────────────────

describe("InputBar — send via button", () => {
  it("calls onSend with trimmed text when button clicked", () => {
    const onSend = vi.fn();
    renderInput({ value: "  hello  ", onSend });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not call onSend when value is empty", () => {
    const onSend = vi.fn();
    renderInput({ value: "", onSend });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend while streaming", () => {
    const onSend = vi.fn();
    renderInput({ value: "hello", isStreaming: true, onSend });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ─── Keyboard — Enter / Shift+Enter ──────────────────────────────────────────

describe("InputBar — keyboard behavior", () => {
  it("Enter key calls onSend", () => {
    const onSend = vi.fn();
    renderInput({ value: "hello", onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Shift+Enter does not call onSend (inserts newline instead)", () => {
    const onSend = vi.fn();
    renderInput({ value: "hello", onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter key does not call onSend when value is empty", () => {
    const onSend = vi.fn();
    renderInput({ value: "", onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter key does not call onSend while streaming", () => {
    const onSend = vi.fn();
    renderInput({ value: "hello", isStreaming: true, onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ─── Streaming state ──────────────────────────────────────────────────────────

describe("InputBar — streaming indicator", () => {
  it("shows waiting message while streaming", () => {
    renderInput({ isStreaming: true });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it("hides waiting message when not streaming", () => {
    renderInput({ isStreaming: false });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("InputBar — axe", () => {
  it("has no critical a11y violations (idle)", async () => {
    const { container } = renderInput({ value: "" });
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (with text)", async () => {
    const { container } = renderInput({ value: "Some question" });
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (streaming)", async () => {
    const { container } = renderInput({ isStreaming: true });
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
