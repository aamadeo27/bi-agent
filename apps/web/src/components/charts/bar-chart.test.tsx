import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ResultEnvelope } from "@bi/contracts";
import { BarChart } from "./bar-chart";

// Mock Recharts — jsdom has no SVG layout engine; we test wrapper behaviour.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children?: ReactNode }) => (
    <svg data-testid="recharts-bar-chart">{children}</svg>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const baseEnvelope: ResultEnvelope = {
  messageId: "m1",
  queryType: "sql",
  chartType: "bar",
  columns: [
    { name: "region", type: "string", role: "dimension" },
    { name: "revenue", type: "number", role: "measure" },
  ],
  rows: [
    { region: "North", revenue: 1200 },
    { region: "South", revenue: 800 },
  ],
  rowCount: 2,
  truncated: false,
};

describe("BarChart", () => {
  it("renders without crashing", () => {
    render(<BarChart envelope={baseEnvelope} />);
    expect(screen.getByTestId("recharts-bar-chart")).toBeInTheDocument();
  });

  it("wraps chart in role=img with aria-label", () => {
    render(<BarChart envelope={baseEnvelope} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("aria-label");
    expect(img.getAttribute("aria-label")).toMatch(/bar chart/i);
    expect(img.getAttribute("aria-label")).toMatch(/revenue/i);
    expect(img.getAttribute("aria-label")).toMatch(/region/i);
    expect(img.getAttribute("aria-label")).toMatch(/2 data points/i);
  });

  it("shows empty state when rows is empty", () => {
    const env: ResultEnvelope = { ...baseEnvelope, rows: [], rowCount: 0 };
    render(<BarChart envelope={env} />);
    expect(screen.getByText(/no data returned for this query/i)).toBeInTheDocument();
    expect(screen.queryByTestId("recharts-bar-chart")).not.toBeInTheDocument();
  });

  it("shows large-result banner when truncated=true", () => {
    const env: ResultEnvelope = { ...baseEnvelope, truncated: true, rowCount: 5000 };
    render(<BarChart envelope={env} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/5,000 rows/i);
  });

  it("shows large-result banner when rowCount exceeds threshold", () => {
    const env: ResultEnvelope = { ...baseEnvelope, rowCount: 1500, truncated: false };
    render(<BarChart envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/1,500 rows/i);
  });

  it("does not show banner for small result", () => {
    render(<BarChart envelope={baseEnvelope} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-downgrades to DataTable with banner when category count >20", () => {
    const manyRows = Array.from({ length: 21 }, (_, i) => ({
      region: `Region${i}`,
      revenue: i * 100,
    }));
    const env: ResultEnvelope = { ...baseEnvelope, rows: manyRows, rowCount: 21 };
    render(<BarChart envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/too many categories/i);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("recharts-bar-chart")).not.toBeInTheDocument();
  });

  it("has no critical accessibility violations", async () => {
    const { container } = render(<BarChart envelope={baseEnvelope} />);
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations in BarChart").toHaveLength(0);
  });
});
