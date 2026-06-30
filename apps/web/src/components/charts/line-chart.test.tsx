import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ResultEnvelope } from "@bi/contracts";
import { LineChart } from "./line-chart";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children?: ReactNode }) => (
    <svg data-testid="recharts-line-chart">{children}</svg>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const baseEnvelope: ResultEnvelope = {
  messageId: "m2",
  queryType: "sql",
  chartType: "line",
  columns: [
    { name: "month", type: "date", role: "time" },
    { name: "sales", type: "number", role: "measure" },
  ],
  rows: [
    { month: "2024-01", sales: 4200 },
    { month: "2024-02", sales: 3800 },
    { month: "2024-03", sales: 5100 },
  ],
  rowCount: 3,
  truncated: false,
};

describe("LineChart", () => {
  it("renders without crashing", () => {
    render(<LineChart envelope={baseEnvelope} />);
    expect(screen.getByTestId("recharts-line-chart")).toBeInTheDocument();
  });

  it("wraps chart in role=img with descriptive aria-label", () => {
    render(<LineChart envelope={baseEnvelope} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("aria-label");
    const label = img.getAttribute("aria-label")!;
    expect(label).toMatch(/line chart/i);
    expect(label).toMatch(/sales/i);
    expect(label).toMatch(/month/i);
    expect(label).toMatch(/3 data points/i);
  });

  it("shows empty state when rows is empty", () => {
    const env: ResultEnvelope = { ...baseEnvelope, rows: [], rowCount: 0 };
    render(<LineChart envelope={env} />);
    expect(screen.getByText(/no data returned for this query/i)).toBeInTheDocument();
    expect(screen.queryByTestId("recharts-line-chart")).not.toBeInTheDocument();
  });

  it("shows large-result banner when truncated=true", () => {
    const env: ResultEnvelope = { ...baseEnvelope, truncated: true, rowCount: 2000 };
    render(<LineChart envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/2,000 rows/i);
  });

  it("does not show banner for small result", () => {
    render(<LineChart envelope={baseEnvelope} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
