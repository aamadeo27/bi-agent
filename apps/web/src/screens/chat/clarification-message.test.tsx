import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ClarificationMessage } from "./clarification-message";

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("ClarificationMessage — rendering", () => {
  it("renders testid", () => {
    render(<ClarificationMessage text="Could you clarify the time period?" />);
    expect(screen.getByTestId("clarification-message")).toBeInTheDocument();
  });

  it("shows 'I need more information' heading", () => {
    render(<ClarificationMessage text="Something" />);
    expect(
      screen.getByRole("heading", { name: /I need more information/i }),
    ).toBeInTheDocument();
  });

  it("renders the clarification text body", () => {
    render(<ClarificationMessage text="Could you clarify what period?" />);
    expect(screen.getByText(/Could you clarify what period\?/)).toBeInTheDocument();
  });

  it("renders empty text without crashing", () => {
    render(<ClarificationMessage text="" />);
    expect(screen.getByTestId("clarification-message")).toBeInTheDocument();
  });

  it("renders markdown in the body (bold)", () => {
    render(<ClarificationMessage text="Please specify **which quarter**." />);
    // renderMarkdown produces a <strong> for **...**
    const strong = screen.getByText("which quarter");
    expect(strong.tagName.toLowerCase()).toBe("strong");
  });

  it("warning-border bubble is present (structural)", () => {
    render(<ClarificationMessage text="Clarify?" />);
    // Verify the inner bubble contains the warning class via data-testid ancestor
    const container = screen.getByTestId("clarification-message");
    // The inner div has the semantic-warning left border class
    expect(container.querySelector(".border-l-semantic-warning")).toBeInTheDocument();
  });

  it("question icon is aria-hidden", () => {
    render(<ClarificationMessage text="text" />);
    const svgs = screen.getByTestId("clarification-message").querySelectorAll("svg");
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });
});

// ─── Accessibility ───────────────────────────────────────────────────────────

describe("ClarificationMessage — axe", () => {
  it("has no critical a11y violations (plain text)", async () => {
    const { container } = render(
      <ClarificationMessage text="Could you clarify what time period?" />,
    );
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (markdown body)", async () => {
    const { container } = render(
      <ClarificationMessage text="Please specify **which region** you mean." />,
    );
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
