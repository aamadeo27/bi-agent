import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { AuditEvent } from "@bi/contracts";
import { getAuditLog, listDataSources } from "../../lib/api-client";
import { AuditLogPage } from "./audit-log-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  getAuditLog: vi.fn(),
  listDataSources: vi.fn(),
}));

const mockGetAuditLog = vi.mocked(getAuditLog);
const mockListDataSources = vi.mocked(listDataSources);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const eventQuery: AuditEvent = {
  id: "evt-1",
  tenantId: "tenant-1",
  at: "2026-06-01T10:00:00.000Z",
  actorUserId: "user-alice",
  roleNameAtEvent: "Analyst",
  type: "query_executed",
  outcome: "success",
  dataSourceId: "ds-1",
  detail: { queryText: "SELECT * FROM orders" },
  ip: "192.168.1.1",
};

const eventBlocked: AuditEvent = {
  id: "evt-2",
  tenantId: "tenant-1",
  at: "2026-06-01T11:00:00.000Z",
  actorUserId: "user-bob",
  roleNameAtEvent: "Viewer",
  type: "query_blocked",
  outcome: "blocked",
  detail: { missing: ["orders.amount", "orders.customer_id"] },
};

const eventLogin: AuditEvent = {
  id: "evt-3",
  tenantId: "tenant-1",
  at: "2026-06-01T09:00:00.000Z",
  actorUserId: "user-alice",
  roleNameAtEvent: "Analyst",
  type: "login",
  outcome: "success",
  detail: {},
  ip: "10.0.0.1",
};

const eventLoginFailed: AuditEvent = {
  id: "evt-4",
  tenantId: "tenant-1",
  at: "2026-06-01T08:00:00.000Z",
  actorUserId: "user-unknown",
  roleNameAtEvent: "",
  type: "login_failed",
  outcome: "error",
  detail: {},
};

const dataSource = {
  id: "ds-1",
  name: "Production DB",
  type: "postgres" as const,
  status: "connected" as const,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(events: AuditEvent[], total?: number) {
  return {
    events,
    total: total ?? events.length,
    page: 1,
    pageSize: 50,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListDataSources.mockResolvedValue([dataSource]);
});

// ─── Loading & error ──────────────────────────────────────────────────────────

describe("AuditLogPage — loading & error states", () => {
  it("shows loading indicator while fetching", () => {
    mockGetAuditLog.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading audit events…");
  });

  it("shows error alert when fetch fails", async () => {
    mockGetAuditLog.mockRejectedValue(new Error("Network error"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load audit log"),
    );
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("AuditLogPage — empty state", () => {
  it("shows default empty state when no events and no filters", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText("No events match your filters."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Audit logging will appear here/),
    ).toBeInTheDocument();
  });
});

// ─── Table rendering ──────────────────────────────────────────────────────────

describe("AuditLogPage — table rendering", () => {
  beforeEach(() => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery, eventBlocked, eventLogin]));
  });

  it("renders table with all 6 column headers", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByRole("columnheader", { name: "Timestamp" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "User" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Event type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Data source" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  it("renders event type labels in human-readable form", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    expect(screen.getByText("Query executed")).toBeInTheDocument();
    expect(screen.getByText("Query blocked")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("shows data source name from lookup", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    // getAllByText because "Production DB" also appears in the filter <option>
    const matches = screen.getAllByText("Production DB");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // At least one should be a table cell (not an option)
    const cellMatch = matches.find((el) => el.closest("td") !== null);
    expect(cellMatch).toBeDefined();
  });

  it("resolves pagination count", async () => {
    mockGetAuditLog.mockResolvedValue({ events: [eventQuery], total: 120, page: 1, pageSize: 50 });
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    // start=1, end=min(50,120)=50
    expect(screen.getByText("Showing 1–50 of 120")).toBeInTheDocument();
  });
});

// ─── Status badge (color + icon + text) ──────────────────────────────────────

describe("AuditLogPage — status badge includes icon and text", () => {
  it("shows icon + 'Success' text for success outcome", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    const badge = screen.getAllByText("Success")[0];
    expect(badge).toBeInTheDocument();
    // Parent span contains both icon (aria-hidden) and text
    const span = badge.closest("span");
    expect(span?.textContent).toMatch(/✓/);
    expect(span?.textContent).toMatch(/Success/);
  });

  it("shows icon + 'Blocked' text for blocked outcome", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventBlocked]));
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    const badge = screen.getByText("Blocked");
    const span = badge.closest("span");
    expect(span?.textContent).toMatch(/⊘/);
    expect(span?.textContent).toMatch(/Blocked/);
  });

  it("shows icon + 'Error' text for error outcome", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventLoginFailed]));
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    const badge = screen.getByText("Error");
    const span = badge.closest("span");
    expect(span?.textContent).toMatch(/✗/);
    expect(span?.textContent).toMatch(/Error/);
  });
});

// ─── Row expansion ────────────────────────────────────────────────────────────

describe("AuditLogPage — row expansion detail panel", () => {
  it("opens detail panel on expand button click", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: /Expand event evt-1/i }));

    expect(screen.getByText("Role at event")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
  });

  it("shows query text in detail panel when present", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: /Expand event evt-1/i }));

    expect(screen.getByText("Query text")).toBeInTheDocument();
    // Query text appears in both the row truncated span and the detail <pre>;
    // assert the <pre> version (inside detail panel)
    const matches = screen.getAllByText("SELECT * FROM orders");
    const preMatch = matches.find((el) => el.tagName === "PRE");
    expect(preMatch).toBeDefined();
  });

  it("shows missing permissions for blocked events", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventBlocked]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: /Expand event evt-2/i }));

    expect(screen.getByText("Missing permissions")).toBeInTheDocument();
    expect(screen.getByText("orders.amount")).toBeInTheDocument();
    expect(screen.getByText("orders.customer_id")).toBeInTheDocument();
  });

  it("shows IP and role in detail panel", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: /Expand event evt-1/i }));

    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
  });

  it("collapses detail panel on second click", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    const btn = screen.getByRole("button", { name: /Expand event evt-1/i });
    await user.click(btn);
    expect(screen.getByText("Role at event")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Collapse event evt-1/i }));
    expect(screen.queryByText("Role at event")).not.toBeInTheDocument();
  });
});

// ─── Filters ──────────────────────────────────────────────────────────────────

describe("AuditLogPage — filters", () => {
  it("passes userId filter to API", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalled());
    const input = screen.getByLabelText(/User ID/i);
    await user.type(input, "alice");

    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "alice" }),
      ),
    );
  });

  it("passes from/to date filter to API", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(mockGetAuditLog).toHaveBeenCalled());
    const fromInput = screen.getByLabelText("From");
    await user.type(fromInput, "2026-06-01");

    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-06-01" }),
      ),
    );
  });

  it("passes dataSourceId filter to API", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    const user = userEvent.setup();
    renderPage();

    // Wait for datasource options to populate before selecting
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Production DB" })).toBeInTheDocument(),
    );
    const select = screen.getByLabelText(/Data source/i);
    await user.selectOptions(select, "ds-1");

    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ dataSourceId: "ds-1" }),
      ),
    );
  });
});

// ─── Pagination ───────────────────────────────────────────────────────────────

describe("AuditLogPage — pagination", () => {
  it("navigates to next page on Next click", async () => {
    mockGetAuditLog
      .mockResolvedValueOnce({ events: [eventQuery], total: 100, page: 1, pageSize: 50 })
      .mockResolvedValue({ events: [eventLogin], total: 100, page: 2, pageSize: 50 });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(mockGetAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  it("Prev button disabled on first page", async () => {
    mockGetAuditLog.mockResolvedValue({ events: [eventQuery], total: 10, page: 1, pageSize: 50 });
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("Next button disabled when on last page", async () => {
    mockGetAuditLog.mockResolvedValue({ events: [eventQuery], total: 1, page: 1, pageSize: 50 });
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});

// ─── CSV export ───────────────────────────────────────────────────────────────

describe("AuditLogPage — CSV export", () => {
  it("Export CSV button is disabled when no events", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    renderPage();
    await waitFor(() => expect(screen.getByText("No events match your filters.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeDisabled();
  });

  it("Export CSV button enabled when events present", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    renderPage();
    await waitFor(() => screen.getByRole("table"));
    expect(screen.getByRole("button", { name: /Export CSV/i })).not.toBeDisabled();
  });
});

// ─── Accessibility (axe) ──────────────────────────────────────────────────────

describe("AuditLogPage — accessibility", () => {
  it("table view passes axe", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery, eventBlocked, eventLogin]));
    const { container } = renderPage();
    await waitFor(() => screen.getByRole("table"));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("empty state passes axe", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([]));
    const { container } = renderPage();
    await waitFor(() => screen.getByText("No events match your filters."));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("loading state passes axe", async () => {
    mockGetAuditLog.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("expanded detail panel passes axe", async () => {
    mockGetAuditLog.mockResolvedValue(makeResponse([eventQuery]));
    const user = userEvent.setup();
    const { container } = renderPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: /Expand event evt-1/i }));

    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});
