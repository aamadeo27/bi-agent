import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { SseHandlers } from "../../lib/sse-client";
import type { ResultEnvelope, PermissionBlock } from "@bi/contracts";
import { connectSse } from "../../lib/sse-client";
import { ChatTimeline, type ChatTimelineHandle } from "./chat-timeline";

// ─── Mock SSE client ──────────────────────────────────────────────────────────

vi.mock("../../lib/sse-client", () => ({
  connectSse: vi.fn(() => () => {}),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ENVELOPE: ResultEnvelope = {
  messageId: "msg-1",
  queryType: "sql",
  chartType: "bar",
  columns: [
    { name: "region", type: "string", role: "dimension" },
    { name: "sales", type: "number", role: "measure" },
  ],
  rows: [
    { region: "North", sales: 1000 },
    { region: "South", sales: 800 },
  ],
  rowCount: 2,
  truncated: false,
};

const BLOCK: PermissionBlock = {
  messageId: "msg-2",
  roleName: "Analyst",
  missing: [
    { kind: "table", identifier: "sales.orders", accessNeeded: "read" },
  ],
};

// ─── Render helper ────────────────────────────────────────────────────────────

function renderTimeline(conversationId = "conv-1") {
  const ref = createRef<ChatTimelineHandle>();
  const onStreamingChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const utils = render(
    <QueryClientProvider client={qc}>
      <ChatTimeline
        ref={ref}
        conversationId={conversationId}
        onStreamingChange={onStreamingChange}
      />
    </QueryClientProvider>,
  );

  return { ...utils, ref, onStreamingChange, qc };
}

/** Capture the handlers passed to the last connectSse call. */
function captureHandlers(): SseHandlers {
  const mock = vi.mocked(connectSse);
  const lastCall = mock.mock.calls[mock.mock.calls.length - 1];
  return lastCall[2];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChatTimeline — empty state", () => {
  it("shows empty placeholder when no messages", () => {
    renderTimeline();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });
});

describe("ChatTimeline — user message + streaming indicator", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("shows user bubble immediately after send()", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Show me sales by region");
    });
    expect(screen.getByTestId("message-bubble")).toBeInTheDocument();
    expect(screen.getByText("Show me sales by region")).toBeInTheDocument();
  });

  it("shows StreamingIndicator while pending (before first token)", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Hello");
    });
    expect(screen.getByTestId("streaming-indicator")).toBeInTheDocument();
  });

  it("calls onStreamingChange(true) when send() is called", () => {
    const { ref, onStreamingChange } = renderTimeline();
    act(() => {
      ref.current!.send("Hello");
    });
    expect(onStreamingChange).toHaveBeenCalledWith(true);
  });
});

describe("ChatTimeline — token streaming", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("swaps StreamingIndicator for SystemMessageBubble on first token", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("User query here");
    });
    expect(screen.getByTestId("streaming-indicator")).toBeInTheDocument();

    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "Assistant response" });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("streaming-indicator")).not.toBeInTheDocument();
      expect(screen.getByTestId("system-message-bubble")).toBeInTheDocument();
    });
    expect(screen.getByText(/Assistant response/)).toBeInTheDocument();
  });

  it("accumulates token deltas into a single bubble", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Query");
    });
    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "Part1 " });
      h.token?.({ delta: "Part2" });
    });
    await waitFor(() =>
      expect(screen.getByText(/Part1 Part2/)).toBeInTheDocument(),
    );
  });
});

describe("ChatTimeline — result event", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("mounts ChartCard when result event arrives", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Sales query");
    });
    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "Here are results:" });
      h.result?.({ envelope: ENVELOPE });
    });
    await waitFor(() =>
      expect(screen.getByTestId("chart-card")).toBeInTheDocument(),
    );
  });

  it("caches result envelope in TanStack Query keyed by messageId", async () => {
    const { ref, qc } = renderTimeline();
    act(() => {
      ref.current!.send("Sales query");
    });
    act(() => {
      const h = captureHandlers();
      h.result?.({ envelope: ENVELOPE });
    });
    await waitFor(() =>
      expect(qc.getQueryData(["message-result", "msg-1"])).toEqual(ENVELOPE),
    );
  });
});

describe("ChatTimeline — done event", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("calls onStreamingChange(false) on done event", async () => {
    const { ref, onStreamingChange } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "answer" });
      h.done?.({ messageId: "msg-x" });
    });
    await waitFor(() => expect(onStreamingChange).toHaveBeenCalledWith(false));
  });

  it("keeps SystemMessageBubble visible after done", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "Final answer" });
      h.done?.({ messageId: "msg-x" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("system-message-bubble")).toBeInTheDocument(),
    );
  });
});

describe("ChatTimeline — block event", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("renders PermissionBlockMessage on block event", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Restricted query");
    });
    act(() => {
      const h = captureHandlers();
      h.block?.({ block: BLOCK });
    });
    await waitFor(() =>
      expect(screen.getByTestId("permission-block-message")).toBeInTheDocument(),
    );
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.getByText("sales.orders")).toBeInTheDocument();
  });

  it("calls onStreamingChange(false) on block", async () => {
    const { ref, onStreamingChange } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.block?.({ block: BLOCK });
    });
    await waitFor(() => expect(onStreamingChange).toHaveBeenCalledWith(false));
  });
});

describe("ChatTimeline — error event", () => {
  beforeEach(() => {
    vi.mocked(connectSse).mockReturnValue(() => {});
  });

  it("renders error bubble on error event", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.error?.({ code: "LLM_ERROR", message: "LLM unavailable" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("error-message")).toBeInTheDocument(),
    );
    expect(screen.getByText(/LLM unavailable/)).toBeInTheDocument();
  });

  it("renders ClarificationMessage on CLARIFICATION error", async () => {
    const { ref } = renderTimeline();
    act(() => {
      ref.current!.send("Ambiguous query");
    });
    act(() => {
      const h = captureHandlers();
      // Clarification text arrives via tokens before the error terminal event
      h.token?.({ delta: "Could you clarify what period?" });
      h.error?.({ code: "CLARIFICATION", message: "" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("clarification-message")).toBeInTheDocument(),
    );
    expect(screen.getByText(/I need more information/i)).toBeInTheDocument();
  });

  it("calls onStreamingChange(false) on error", async () => {
    const { ref, onStreamingChange } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.error?.({ code: "INTERNAL", message: "Boom" });
    });
    await waitFor(() => expect(onStreamingChange).toHaveBeenCalledWith(false));
  });
});

describe("ChatTimeline — conversation change resets messages", () => {
  it("clears messages when conversationId prop changes", async () => {
    vi.mocked(connectSse).mockReturnValue(() => {});
    const qc = new QueryClient();
    const ref = createRef<ChatTimelineHandle>();

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ChatTimeline ref={ref} conversationId="conv-A" />
      </QueryClientProvider>,
    );

    act(() => {
      ref.current!.send("Hello");
    });
    expect(screen.getByTestId("message-bubble")).toBeInTheDocument();

    // Navigate to a different conversation
    rerender(
      <QueryClientProvider client={qc}>
        <ChatTimeline ref={ref} conversationId="conv-B" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByTestId("message-bubble")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ChatTimeline — axe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no critical a11y violations in empty state", async () => {
    const { container } = renderTimeline();
    const results = await axe.run(container);
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      critical,
      `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("has no critical a11y violations with streaming indicator", async () => {
    vi.mocked(connectSse).mockReturnValue(() => {});
    const { container, ref } = renderTimeline();
    act(() => {
      ref.current!.send("Hello");
    });
    // StreamingIndicator rendered
    await waitFor(() =>
      expect(screen.getByTestId("streaming-indicator")).toBeInTheDocument(),
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

  it("has no critical a11y violations with system message", async () => {
    vi.mocked(connectSse).mockReturnValue(() => {});
    const { container, ref } = renderTimeline();
    act(() => {
      ref.current!.send("Hello");
    });
    act(() => {
      const h = captureHandlers();
      h.token?.({ delta: "Some response text" });
      h.done?.({ messageId: "m1" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("system-message-bubble")).toBeInTheDocument(),
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

  it("has no critical a11y violations with PermissionBlockMessage", async () => {
    vi.mocked(connectSse).mockReturnValue(() => {});
    const { container, ref } = renderTimeline();
    act(() => {
      ref.current!.send("Q");
    });
    act(() => {
      const h = captureHandlers();
      h.block?.({ block: BLOCK });
    });
    await waitFor(() =>
      expect(screen.getByTestId("permission-block-message")).toBeInTheDocument(),
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
