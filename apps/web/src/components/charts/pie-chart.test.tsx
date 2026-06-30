import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ResultEnvelope } from "@bi/contracts";
import { PieChart } from "./pie-chart";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: { children?: ReactNode }) => (
    <svg data-testid="recharts-pie-chart">{children}</svg>
  ),
  Pie: ({
    children,
    data,
  }: {
    children?: ReactNode;
    data?: Array<{ name: string; value: number }>;
  }) => (
    <g data-testid="recharts-pie" data-count={data?.length ?? 0}>
      {children}
    </g>
  ),
  Cell: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <path data-testid="recharts-cell" aria-label={ariaLabel} />
  ),
  Tooltip: () => null,
  Legend: () => null,
}));

const baseEnvelope: ResultEnvelope = {
  messageId: "m3",
  queryType: "sql",
  chartType: "pie",
  columns: [
    { name: "category", type: "string", role: "dimension" },
    { name: "amount", type: "number", role: "measure" },
  ],
  rows: [
    { category: "A", amount: 500 },
    { category: "B", amount: 300 },
    { category: "C", amount: 200 },
  ],
  rowCount: 3,
  truncated: false,
};

describe("PieChart", () => {
  it("renders without crashing", () => {
    render(<PieChart envelope={baseEnvelope} />);
    expect(screen.getByTestId("recharts-pie-chart")).toBeInTheDocument();
  });

  it("wraps chart in role=img with aria-label", () => {
    render(<PieChart envelope={baseEnvelope} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("aria-label");
    const label = img.getAttribute("aria-label")!;
    expect(label).toMatch(/pie chart/i);
    expect(label).toMatch(/amount/i);
    expect(label).toMatch(/category/i);
    expect(label).toMatch(/3 data points/i);
  });

  it("renders per-slice aria-labels with label, value and percentage", () => {
    render(<PieChart envelope={baseEnvelope} />);
    const cells = screen.getAllByTestId("recharts-cell");
    // 3 cells for 3 rows
    expect(cells).toHaveLength(3);
    // First slice: A = 500 out of 1000 total = 50.0%
    expect(cells[0]).toHaveAttribute("aria-label", "A: 500 (50.0%)");
    // Second slice: B = 300 out of 1000 = 30.0%
    expect(cells[1]).toHaveAttribute("aria-label", "B: 300 (30.0%)");
    // Third slice: C = 200 out of 1000 = 20.0%
    expect(cells[2]).toHaveAttribute("aria-label", "C: 200 (20.0%)");
  });

  it("shows empty state when rows is empty", () => {
    const env: ResultEnvelope = { ...baseEnvelope, rows: [], rowCount: 0 };
    render(<PieChart envelope={env} />);
    expect(screen.getByText(/no data returned for this query/i)).toBeInTheDocument();
    expect(screen.queryByTestId("recharts-pie-chart")).not.toBeInTheDocument();
  });

  it("shows large-result banner when truncated=true", () => {
    const env: ResultEnvelope = { ...baseEnvelope, truncated: true, rowCount: 3000 };
    render(<PieChart envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/3,000 rows/i);
  });

  it("does not show banner for small result", () => {
    render(<PieChart envelope={baseEnvelope} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-downgrades to DataTable with banner when slice count >20", () => {
    const manyRows = Array.from({ length: 21 }, (_, i) => ({
      category: `Cat${i}`,
      amount: (i + 1) * 50,
    }));
    const env: ResultEnvelope = { ...baseEnvelope, rows: manyRows, rowCount: 21 };
    render(<PieChart envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/too many categories/i);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("recharts-pie-chart")).not.toBeInTheDocument();
  });

  it("has no critical accessibility violations", async () => {
    const { container } = render(<PieChart envelope={baseEnvelope} />);
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations in PieChart").toHaveLength(0);
  });
});
