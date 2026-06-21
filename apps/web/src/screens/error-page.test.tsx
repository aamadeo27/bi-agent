import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { ErrorPage, type ErrorVariant } from "./error-page";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderErrorPage(variant?: ErrorVariant, searchString = "") {
  const path = searchString ? `/?${searchString}` : "/";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ErrorPage variant={variant} />
    </MemoryRouter>,
  );
}

// ─── Variant rendering ────────────────────────────────────────────────────────

describe("ErrorPage variants", () => {
  it("renders 404 Not Found as default", () => {
    renderErrorPage();
    expect(screen.getByRole("heading", { name: "Page Not Found" })).toBeInTheDocument();
    expect(screen.getByText("This page doesn't exist.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to chat" })).toBeInTheDocument();
  });

  it("renders 404 via prop variant", () => {
    renderErrorPage("not-found");
    expect(screen.getByRole("heading", { name: "Page Not Found" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to chat" })).toBeInTheDocument();
  });

  it("renders 403 Forbidden via prop variant", () => {
    renderErrorPage("forbidden");
    expect(screen.getByRole("heading", { name: "Access Forbidden" })).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to view this page.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to chat" })).toBeInTheDocument();
  });

  it("renders tenant boundary via prop variant", () => {
    renderErrorPage("tenant-boundary");
    expect(screen.getByRole("heading", { name: "Workspace Access Denied" })).toBeInTheDocument();
    expect(screen.getByText("You are not authorized to access this workspace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("renders session expired via prop variant", () => {
    renderErrorPage("session-expired");
    expect(screen.getByRole("heading", { name: "Session Expired" })).toBeInTheDocument();
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("falls back to 404 for unknown ?type query param", () => {
    renderErrorPage(undefined, "type=bogus");
    expect(screen.getByRole("heading", { name: "Page Not Found" })).toBeInTheDocument();
  });
});

// ─── CTA navigation ──────────────────────────────────────────────────────────

describe("ErrorPage CTA actions", () => {
  it("Return to chat button is clickable", async () => {
    renderErrorPage("not-found");
    const btn = screen.getByRole("button", { name: "Return to chat" });
    await userEvent.click(btn);
    // MemoryRouter absorbs navigation; no crash = pass
  });

  it("Sign out button is clickable (tenant-boundary)", async () => {
    renderErrorPage("tenant-boundary");
    const btn = screen.getByRole("button", { name: "Sign out" });
    await userEvent.click(btn);
  });

  it("Sign in button is clickable (session-expired)", async () => {
    renderErrorPage("session-expired");
    const btn = screen.getByRole("button", { name: "Sign in" });
    await userEvent.click(btn);
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ErrorPage accessibility (axe)", () => {
  const variants: ErrorVariant[] = [
    "not-found",
    "forbidden",
    "tenant-boundary",
    "session-expired",
  ];

  for (const variant of variants) {
    it(`${variant} has no critical a11y violations`, async () => {
      const { container } = renderErrorPage(variant);
      const results = await axe.run(container);
      const critical = results.violations.filter((v) => v.impact === "critical");
      expect(critical, `Critical violations on ${variant}: ${JSON.stringify(critical.map((v) => v.id))}`).toHaveLength(0);
    });
  }
});
