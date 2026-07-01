import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { PermissionBlock } from "@bi/contracts";
import { PermissionBlockMessage } from "./permission-block-message";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BLOCK_TABLE: PermissionBlock = {
  messageId: "msg-1",
  roleName: "Analyst",
  missing: [
    { kind: "table", identifier: "sales.orders", accessNeeded: "read" },
  ],
};

const BLOCK_MULTI: PermissionBlock = {
  messageId: "msg-2",
  roleName: "Viewer",
  missing: [
    { kind: "table", identifier: "sales.orders", accessNeeded: "read" },
    { kind: "column", identifier: "sales.orders.revenue", accessNeeded: "read" },
    { kind: "schema", identifier: "finance", accessNeeded: "read" },
  ],
};

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("PermissionBlockMessage — rendering", () => {
  it("renders testid and role=alert", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    const el = screen.getByTestId("permission-block-message");
    expect(el).toBeInTheDocument();
    // Inner alert div
    expect(el.querySelector('[role="alert"]')).toBeInTheDocument();
  });

  it("shows 'Access restricted' heading", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(screen.getByRole("heading", { name: /access restricted/i })).toBeInTheDocument();
  });

  it("body text includes role name", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(screen.getByText(/Analyst/)).toBeInTheDocument();
  });

  it("body text matches Flow 6 wording", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(
      screen.getByText(/does not have access to the following resources required to answer/i),
    ).toBeInTheDocument();
  });

  it("renders each missing identifier in monospace", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    const code = screen.getByText("sales.orders");
    expect(code.tagName.toLowerCase()).toBe("code");
  });

  it("shows 'Access needed: read' for each item", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(screen.getByText(/Access needed: read/i)).toBeInTheDocument();
  });

  it("renders all missing resources", () => {
    render(<PermissionBlockMessage block={BLOCK_MULTI} />);
    expect(screen.getByText("sales.orders")).toBeInTheDocument();
    expect(screen.getByText("sales.orders.revenue")).toBeInTheDocument();
    expect(screen.getByText("finance")).toBeInTheDocument();
  });

  it("footer suggests contacting admin", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(
      screen.getByText(/contact your administrator to request access/i),
    ).toBeInTheDocument();
  });

  it("footer mentions rephrasing option", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(screen.getByText(/try rephrasing your question/i)).toBeInTheDocument();
  });

  it("has aria-label on the resource list", () => {
    render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    expect(screen.getByRole("list", { name: /blocked resources/i })).toBeInTheDocument();
  });
});

// ─── Accessibility ───────────────────────────────────────────────────────────

describe("PermissionBlockMessage — axe", () => {
  it("has no critical a11y violations (single resource)", async () => {
    const { container } = render(<PermissionBlockMessage block={BLOCK_TABLE} />);
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations (multiple resources)", async () => {
    const { container } = render(<PermissionBlockMessage block={BLOCK_MULTI} />);
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
