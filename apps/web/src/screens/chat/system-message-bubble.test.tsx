import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ResultEnvelope } from "@bi/contracts";
import { SystemMessageBubble } from "./system-message-bubble";

// ChartCard uses TanStack Query; wrap in a provider for envelope tests.
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ENVELOPE: ResultEnvelope = {
  messageId: "m1",
  queryType: "sql",
  chartType: "bar",
  columns: [
    { name: "region", type: "string", role: "dimension" },
    { name: "sales", type: "number", role: "measure" },
  ],
  rows: [{ region: "North", sales: 1000 }],
  rowCount: 1,
  truncated: false,
};

// ─── Normal (no-error) state ─────────────────────────────────────────────────

describe("SystemMessageBubble — normal state", () => {
  it("renders testid", () => {
    wrap(<SystemMessageBubble text="Hello" />);
    expect(screen.getByTestId("system-message-bubble")).toBeInTheDocument();
  });

  it("renders text content", () => {
    wrap(<SystemMessageBubble text="Some response" />);
    expect(screen.getByText("Some response")).toBeInTheDocument();
  });

  it("shows blinking cursor when isStreaming=true", () => {
    wrap(<SystemMessageBubble text="partial" isStreaming />);
    // Cursor span is aria-hidden — find by class
    const bubble = screen.getByTestId("system-message-bubble");
    expect(bubble.querySelector(".animate-blink")).toBeInTheDocument();
  });

  it("does not show error heading or Try again in normal state", () => {
    wrap(<SystemMessageBubble text="OK" />);
    expect(screen.queryByRole("heading", { name: /something went wrong/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("try-again-button")).not.toBeInTheDocument();
  });

  it("renders ChartCard when envelope provided", () => {
    wrap(<SystemMessageBubble text="Results:" envelope={ENVELOPE} />);
    expect(screen.getByTestId("chart-card")).toBeInTheDocument();
  });
});

// ─── Error state ─────────────────────────────────────────────────────────────

describe("SystemMessageBubble — error state", () => {
  it("shows 'Something went wrong' heading when errorMsg is set", () => {
    wrap(<SystemMessageBubble text="" errorMsg="LLM unavailable" />);
    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
  });

  it("shows error body text", () => {
    wrap(<SystemMessageBubble text="" errorMsg="LLM unavailable" />);
    expect(screen.getByTestId("error-message")).toHaveTextContent("LLM unavailable");
  });

  it("has role=alert on the bubble when errorMsg is set", () => {
    wrap(<SystemMessageBubble text="" errorMsg="Server error" />);
    const bubble = screen.getByTestId("system-message-bubble");
    // The inner bubble div should carry role=alert
    expect(bubble.querySelector('[role="alert"]')).toBeInTheDocument();
  });

  it("does NOT show Try again when onRetry not provided", () => {
    wrap(<SystemMessageBubble text="" errorMsg="Oops" />);
    expect(screen.queryByTestId("try-again-button")).not.toBeInTheDocument();
  });

  it("shows Try again button when onRetry provided", () => {
    wrap(
      <SystemMessageBubble text="" errorMsg="Oops" onRetry={() => {}} />,
    );
    expect(screen.getByTestId("try-again-button")).toBeInTheDocument();
  });

  it("calls onRetry when Try again button clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    wrap(<SystemMessageBubble text="" errorMsg="Oops" onRetry={onRetry} />);
    await user.click(screen.getByTestId("try-again-button"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("icon and text both present — not color-only signal", () => {
    wrap(<SystemMessageBubble text="" errorMsg="Error" onRetry={() => {}} />);
    const bubble = screen.getByTestId("system-message-bubble");
    // SVG icon present (aria-hidden) AND text heading present
    expect(bubble.querySelector("svg")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("SystemMessageBubble — axe", () => {
  it("no critical violations in normal state", async () => {
    const { container } = wrap(<SystemMessageBubble text="Normal response" />);
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("no critical violations in error state with Try again", async () => {
    const { container } = wrap(
      <SystemMessageBubble
        text=""
        errorMsg="Something failed. Please try again."
        onRetry={() => {}}
      />,
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
