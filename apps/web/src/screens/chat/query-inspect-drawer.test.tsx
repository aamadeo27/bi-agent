import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { GeneratedQueryView } from "@bi/contracts";
import { getGeneratedQuery } from "../../lib/api-client";
import { QueryInspectDrawer } from "./query-inspect-drawer";
import { SystemMessageBubble } from "./system-message-bubble";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  getGeneratedQuery: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QUERY_DATA: GeneratedQueryView = {
  messageId: "msg-1",
  queryType: "sql",
  queryText: "SELECT id, name\nFROM users\nWHERE active = true",
  dataSourceName: "Production DB",
  executedAt: "2026-06-30T10:00:00.000Z",
  rowCount: 42,
};

// ─── Render helpers ───────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDrawer(props: { messageId?: string; isOpen?: boolean; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  const qc = makeQc();
  const utils = render(
    <QueryClientProvider client={qc}>
      <QueryInspectDrawer
        messageId={props.messageId ?? "msg-1"}
        isOpen={props.isOpen ?? true}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

function renderBubble(props: {
  messageId?: string | null;
  canInspectQuery?: boolean;
  text?: string;
} = {}) {
  const qc = makeQc();
  // Only pass messageId when it is not undefined (exactOptionalPropertyTypes compatibility)
  const msgProps =
    props.messageId !== undefined ? { messageId: props.messageId } : {};
  return render(
    <QueryClientProvider client={qc}>
      <SystemMessageBubble
        text={props.text ?? "Here are the results."}
        canInspectQuery={props.canInspectQuery ?? false}
        {...msgProps}
      />
    </QueryClientProvider>,
  );
}

/** Spy on the clipboard stub defined in vitest.setup.ts. */
function stubClipboard() {
  const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  return spy;
}

// ─── "View query" button gating ───────────────────────────────────────────────

describe("SystemMessageBubble — View query button", () => {
  it("hidden when canInspectQuery is false", () => {
    renderBubble({ messageId: "msg-1", canInspectQuery: false });
    expect(screen.queryByTestId("view-query-button")).toBeNull();
  });

  it("hidden when messageId is null even if canInspectQuery is true", () => {
    renderBubble({ messageId: null, canInspectQuery: true });
    expect(screen.queryByTestId("view-query-button")).toBeNull();
  });

  it("hidden when messageId is absent even if canInspectQuery is true", () => {
    renderBubble({ canInspectQuery: true }); // no messageId prop
    expect(screen.queryByTestId("view-query-button")).toBeNull();
  });

  it("shown when canInspectQuery is true and messageId is set", () => {
    renderBubble({ messageId: "msg-1", canInspectQuery: true });
    expect(screen.getByTestId("view-query-button")).toBeInTheDocument();
  });

  it("opens the drawer on click", async () => {
    vi.mocked(getGeneratedQuery).mockResolvedValue(QUERY_DATA);
    const user = userEvent.setup();
    renderBubble({ messageId: "msg-1", canInspectQuery: true });
    await user.click(screen.getByTestId("view-query-button"));
    expect(screen.getByRole("dialog", { name: "Generated query" })).toBeInTheDocument();
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe("QueryInspectDrawer — loading state", () => {
  it("shows skeleton while fetching", () => {
    vi.mocked(getGeneratedQuery).mockReturnValue(new Promise(() => {}));
    renderDrawer();
    expect(screen.getByTestId("code-skeleton")).toBeInTheDocument();
  });
});

// ─── Error state ──────────────────────────────────────────────────────────────

describe("QueryInspectDrawer — error state", () => {
  it("shows 'Query details not available' on fetch error", async () => {
    vi.mocked(getGeneratedQuery).mockRejectedValue({ code: "NOT_FOUND", message: "Not found" });
    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("query-error")).toBeInTheDocument());
    expect(screen.getByText("Query details not available.")).toBeInTheDocument();
  });
});

// ─── Populated state ──────────────────────────────────────────────────────────

describe("QueryInspectDrawer — populated state", () => {
  beforeEach(() => {
    vi.mocked(getGeneratedQuery).mockResolvedValue(QUERY_DATA);
  });

  it("renders drawer title via accessible dialog role", async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Generated query" })).toBeInTheDocument(),
    );
  });

  it("renders data source name in metadata strip", async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("data-source-name")).toHaveTextContent("Production DB"),
    );
  });

  it("renders SQL type badge", async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("query-type-badge")).toHaveTextContent("SQL"),
    );
  });

  it("renders REST type badge for rest queries", async () => {
    vi.mocked(getGeneratedQuery).mockResolvedValue({ ...QUERY_DATA, queryType: "rest" });
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("query-type-badge")).toHaveTextContent("REST"),
    );
  });

  it("renders row count in metadata strip", async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("row-count")).toHaveTextContent("42 rows"),
    );
  });

  it("renders the code block with query text", async () => {
    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("code-block")).toBeInTheDocument());
    // SQL keyword rendered by the tokeniser
    const block = screen.getByTestId("code-block");
    expect(within(block).getAllByText("SELECT").length).toBeGreaterThan(0);
  });

  it("renders one table row per line of query text", async () => {
    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("code-block")).toBeInTheDocument());
    const rows = screen.getByTestId("code-block").querySelectorAll("tr");
    // QUERY_DATA.queryText has 3 lines
    expect(rows).toHaveLength(3);
  });

  it("shows footer help link", async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByText("Learn more about how queries are generated")).toBeInTheDocument(),
    );
  });
});

// ─── Copy to clipboard ────────────────────────────────────────────────────────

describe("QueryInspectDrawer — copy to clipboard", () => {
  beforeEach(() => {
    vi.mocked(getGeneratedQuery).mockResolvedValue(QUERY_DATA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers(); // guard against fake-timer leakage
  });

  it("calls clipboard.writeText with the query text", async () => {
    const writeText = stubClipboard();
    const user = userEvent.setup();
    renderDrawer();
    const btn = await screen.findByTestId("copy-button");
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith(QUERY_DATA.queryText);
  });

  it("shows 'Copied!' immediately after click", async () => {
    stubClipboard();
    const user = userEvent.setup();
    renderDrawer();
    const btn = await screen.findByTestId("copy-button");
    expect(btn).toHaveTextContent("Copy");
    await user.click(btn);
    // setState is triggered after the async clipboard write resolves
    await waitFor(() =>
      expect(screen.getByTestId("copy-button")).toHaveTextContent("Copied!"),
    );
  });

  it("reverts label to 'Copy' after 2 seconds (real timers)", async () => {
    stubClipboard();
    const user = userEvent.setup();
    renderDrawer();
    const btn = await screen.findByTestId("copy-button");
    await user.click(btn);
    await waitFor(() =>
      expect(screen.getByTestId("copy-button")).toHaveTextContent("Copied!"),
    );
    await waitFor(
      () => expect(screen.getByTestId("copy-button")).toHaveTextContent("Copy"),
      { timeout: 3000 },
    );
  }, 8000);
});

// ─── Close behaviour ──────────────────────────────────────────────────────────

describe("QueryInspectDrawer — close", () => {
  beforeEach(() => {
    vi.mocked(getGeneratedQuery).mockResolvedValue(QUERY_DATA);
  });

  it("calls onClose when X button is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Generated query" })).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("drawer-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Generated query" })).toBeInTheDocument(),
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when isOpen is false", () => {
    vi.mocked(getGeneratedQuery).mockReturnValue(new Promise(() => {}));
    renderDrawer({ isOpen: false });
    expect(screen.queryByRole("dialog", { name: "Generated query" })).toBeNull();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("QueryInspectDrawer — accessibility (axe)", () => {
  it("populated drawer has no axe violations", async () => {
    vi.mocked(getGeneratedQuery).mockResolvedValue(QUERY_DATA);
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("metadata-strip")).toBeInTheDocument(),
    );
    // Scan document.body — drawer is portalled outside the render container
    const results = await axe.run(document.body);
    expect(results.violations).toHaveLength(0);
  });

  it("error state has no axe violations", async () => {
    vi.mocked(getGeneratedQuery).mockRejectedValue({ code: "NOT_FOUND", message: "Not found" });
    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("query-error")).toBeInTheDocument());
    const results = await axe.run(document.body);
    expect(results.violations).toHaveLength(0);
  });
});
