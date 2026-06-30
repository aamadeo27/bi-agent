import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { ChartCard } from "./chart-card";
import type { ResultEnvelope } from "@bi/contracts";
import { LARGE_RESULT_THRESHOLD } from "./charts/chart-colors";

// ─── Recharts mock (no real SVG in jsdom) ────────────────────────────────────

// Recharts mock: chart containers render a real <svg> so export can find it
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("svg", { xmlns: "http://www.w3.org/2000/svg" }, children),
  LineChart: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("svg", { xmlns: "http://www.w3.org/2000/svg" }, children),
  PieChart: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("svg", { xmlns: "http://www.w3.org/2000/svg" }, children),
  Bar: () => null,
  Line: () => null,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

// ─── Canvas + URL + anchor mocks ─────────────────────────────────────────────

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
const mockAnchorClick = vi.fn();
const mockToBlob = vi.fn(
  (cb: (blob: Blob | null) => void, type?: string) => {
    cb(new Blob(["data"], { type: type ?? "image/png" }));
  }
);

beforeEach(() => {
  // jsdom doesn't implement URL.createObjectURL; assign directly
  URL.createObjectURL = mockCreateObjectURL;
  URL.revokeObjectURL = mockRevokeObjectURL;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    mockToBlob as typeof HTMLCanvasElement.prototype.toBlob
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    mockAnchorClick
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockAnchorClick.mockReset();
  mockToBlob.mockReset();
  mockCreateObjectURL.mockReset().mockReturnValue("blob:mock-url");
  mockRevokeObjectURL.mockReset();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeBarEnvelope(overrides?: Partial<ResultEnvelope>): ResultEnvelope {
  return {
    messageId: "msg-1",
    queryType: "sql",
    chartType: "bar",
    columns: [
      { name: "region", type: "string", role: "dimension" },
      { name: "revenue", type: "number", role: "measure" },
    ],
    rows: [
      { region: "East", revenue: 1200 },
      { region: "West", revenue: 900 },
    ],
    rowCount: 2,
    truncated: false,
    ...overrides,
  };
}

function makeTableEnvelope(overrides?: Partial<ResultEnvelope>): ResultEnvelope {
  return {
    ...makeBarEnvelope(),
    chartType: "table",
    ...overrides,
  };
}

function makeLargeEnvelope(): ResultEnvelope {
  return makeBarEnvelope({
    rowCount: LARGE_RESULT_THRESHOLD + 1,
    truncated: true,
  });
}

// ─── Toggle tests ─────────────────────────────────────────────────────────────

describe("ChartCard — toggle", () => {
  it("renders chart view initially for bar chart", () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  it("toggle button present for chart types; absent when chartType is table", () => {
    const { rerender } = render(<ChartCard envelope={makeBarEnvelope()} />);
    expect(screen.getByTestId("toggle-view-btn")).toBeInTheDocument();

    rerender(<ChartCard envelope={makeTableEnvelope()} />);
    expect(screen.queryByTestId("toggle-view-btn")).not.toBeInTheDocument();
  });

  it("switches to table view on toggle click (instant from cache)", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    const btn = screen.getByTestId("toggle-view-btn");

    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(btn);

    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches back to chart view on second toggle click", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    const btn = screen.getByTestId("toggle-view-btn");

    await userEvent.click(btn);
    await userEvent.click(btn);

    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("table type shows table immediately, no toggle", () => {
    render(<ChartCard envelope={makeTableEnvelope()} />);
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    expect(screen.queryByTestId("toggle-view-btn")).not.toBeInTheDocument();
  });

  it("toggle label says 'Table view' when chart is shown", () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    expect(screen.getByTestId("toggle-view-btn")).toHaveTextContent("Table view");
  });

  it("toggle label says 'Chart view' when table is shown", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("toggle-view-btn"));
    expect(screen.getByTestId("toggle-view-btn")).toHaveTextContent("Chart view");
  });
});

// ─── Loading / empty / large-result states ───────────────────────────────────

describe("ChartCard — states", () => {
  it("renders skeleton when isLoading=true", () => {
    render(<ChartCard envelope={makeBarEnvelope()} isLoading />);
    expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("renders empty state when rows is empty", () => {
    render(<ChartCard envelope={makeBarEnvelope({ rows: [], rowCount: 0 })} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText(/no data returned/i)).toBeInTheDocument();
  });

  it("renders large-result banner when rowCount > threshold", () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    expect(screen.getByTestId("large-result-banner")).toBeInTheDocument();
    expect(screen.getByText(/rows/i)).toBeInTheDocument();
  });

  it("does not render large-result banner at or below threshold", () => {
    render(
      <ChartCard envelope={makeBarEnvelope({ rowCount: LARGE_RESULT_THRESHOLD })} />
    );
    expect(screen.queryByTestId("large-result-banner")).not.toBeInTheDocument();
  });

  it("renders notes banner when envelope.notes is present", () => {
    render(
      <ChartCard
        envelope={makeBarEnvelope({ notes: "downgraded to table: >2000 rows" })}
      />
    );
    expect(screen.getByTestId("notes-banner")).toBeInTheDocument();
    expect(screen.getByText(/downgraded to table/i)).toBeInTheDocument();
  });

  it("renders chart-type badge with correct label", () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    expect(screen.getByText("Bar chart")).toBeInTheDocument();
  });
});

// ─── Export — CSV ────────────────────────────────────────────────────────────

describe("ChartCard — export CSV", () => {
  it("opens export popover and triggers CSV download", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const csvItem = await screen.findByTestId("export-csv");
    fireEvent.click(csvItem);

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    expect(mockAnchorClick).toHaveBeenCalled();
  });

  it("CSV export uses correct filename", async () => {
    const env = makeBarEnvelope({ messageId: "msg-abc" });
    render(<ChartCard envelope={env} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const csvItem = await screen.findByTestId("export-csv");
    let anchorDownload = "";
    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementationOnce((node) => {
      if (node instanceof HTMLAnchorElement) {
        anchorDownload = node.download;
      }
      return node;
    });
    fireEvent.click(csvItem);

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    expect(anchorDownload).toBe("bi-export-msg-abc.csv");
    appendSpy.mockRestore();
  });
});

// ─── Export — JSON ───────────────────────────────────────────────────────────

describe("ChartCard — export JSON", () => {
  it("triggers JSON download", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const jsonItem = await screen.findByTestId("export-json");
    fireEvent.click(jsonItem);

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    expect(mockAnchorClick).toHaveBeenCalled();
  });

  it("JSON export uses correct filename", async () => {
    const env = makeBarEnvelope({ messageId: "msg-xyz" });
    render(<ChartCard envelope={env} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const jsonItem = await screen.findByTestId("export-json");
    let anchorDownload = "";
    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementationOnce((node) => {
      if (node instanceof HTMLAnchorElement) {
        anchorDownload = node.download;
      }
      return node;
    });
    fireEvent.click(jsonItem);

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    expect(anchorDownload).toBe("bi-export-msg-xyz.json");
    appendSpy.mockRestore();
  });
});

// ─── Export — PNG/JPEG ───────────────────────────────────────────────────────

describe("ChartCard — export PNG/JPEG", () => {
  it("shows export popover with PNG and JPEG options", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    expect(await screen.findByTestId("export-png")).toBeInTheDocument();
    expect(screen.getByTestId("export-jpeg")).toBeInTheDocument();
  });

  it("PNG export: calls toBlob with image/png type", async () => {
    // Stub XMLSerializer before render
    vi.spyOn(XMLSerializer.prototype, "serializeToString").mockReturnValue(
      "<svg></svg>"
    );

    // FakeImage triggers onload synchronously
    class FakeImage {
      private _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      get src(): string {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("Image", FakeImage);

    mockToBlob.mockImplementation(
      (cb: (blob: Blob | null) => void, type?: string) => {
        cb(new Blob(["data"], { type: type ?? "image/png" }));
      }
    );

    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const pngItem = await screen.findByTestId("export-png");
    fireEvent.click(pngItem);

    await waitFor(() => expect(mockToBlob).toHaveBeenCalled());
    const callArgs = mockToBlob.mock.calls[0] as [
      (blob: Blob | null) => void,
      string?
    ];
    expect(callArgs[1]).toBe("image/png");
  });

  it("JPEG export: calls toBlob with image/jpeg type", async () => {
    vi.spyOn(XMLSerializer.prototype, "serializeToString").mockReturnValue(
      "<svg></svg>"
    );

    class FakeImage {
      private _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      get src(): string {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("Image", FakeImage);

    mockToBlob.mockImplementation(
      (cb: (blob: Blob | null) => void, type?: string) => {
        cb(new Blob(["data"], { type: type ?? "image/jpeg" }));
      }
    );

    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const jpegItem = await screen.findByTestId("export-jpeg");
    fireEvent.click(jpegItem);

    await waitFor(() => expect(mockToBlob).toHaveBeenCalled());
    const callArgs = mockToBlob.mock.calls[0] as [
      (blob: Blob | null) => void,
      string?
    ];
    expect(callArgs[1]).toBe("image/jpeg");
  });
});

// ─── Large-export warning ─────────────────────────────────────────────────────

describe("ChartCard — large-export warning", () => {
  it("shows warning dialog before CSV export when rowCount > threshold", async () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const csvItem = await screen.findByTestId("export-csv");
    fireEvent.click(csvItem);

    expect(screen.getByTestId("large-export-warning")).toBeInTheDocument();
    expect(screen.getByText(/large export/i)).toBeInTheDocument();
  });

  it("shows warning dialog before JSON export when rowCount > threshold", async () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));

    const jsonItem = await screen.findByTestId("export-json");
    fireEvent.click(jsonItem);

    expect(screen.getByTestId("large-export-warning")).toBeInTheDocument();
  });

  it("cancels export when Cancel clicked in warning dialog", async () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(await screen.findByTestId("export-csv"));

    await userEvent.click(screen.getByTestId("large-export-cancel"));

    expect(screen.queryByTestId("large-export-warning")).not.toBeInTheDocument();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });

  it("proceeds with export when Continue clicked in warning dialog", async () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(await screen.findByTestId("export-csv"));

    await userEvent.click(screen.getByTestId("large-export-confirm"));

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    expect(screen.queryByTestId("large-export-warning")).not.toBeInTheDocument();
  });

  it("does NOT show warning for PNG export on large results", async () => {
    render(<ChartCard envelope={makeLargeEnvelope()} />);
    await userEvent.click(screen.getByTestId("export-btn"));
    fireEvent.click(await screen.findByTestId("export-png"));

    expect(screen.queryByTestId("large-export-warning")).not.toBeInTheDocument();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ChartCard — accessibility", () => {
  it("has no critical axe violations (bar chart, chart view)", async () => {
    const { container } = render(<ChartCard envelope={makeBarEnvelope()} />);
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations").toHaveLength(0);
  });

  it("has no critical axe violations (bar chart, table view)", async () => {
    const { container } = render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("toggle-view-btn"));
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations in table view").toHaveLength(0);
  });

  it("has no critical axe violations (empty state)", async () => {
    const { container } = render(
      <ChartCard envelope={makeBarEnvelope({ rows: [], rowCount: 0 })} />
    );
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical).toHaveLength(0);
  });

  it("has no critical axe violations (loading state)", async () => {
    const { container } = render(
      <ChartCard envelope={makeBarEnvelope()} isLoading />
    );
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical).toHaveLength(0);
  });
});

// ─── DataTable (via toggle) ───────────────────────────────────────────────────

describe("DataTableView (via ChartCard table toggle)", () => {
  it("renders column headers", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("toggle-view-btn"));
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();
  });

  it("renders row data", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("toggle-view-btn"));
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
  });

  it("shows pagination row count label", async () => {
    render(<ChartCard envelope={makeBarEnvelope()} />);
    await userEvent.click(screen.getByTestId("toggle-view-btn"));
    expect(screen.getByText(/Showing 1–2 of 2 results/)).toBeInTheDocument();
  });
});
