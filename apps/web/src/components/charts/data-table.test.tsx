import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResultEnvelope } from "@bi/contracts";
import { DataTable } from "./data-table";

// Generate N rows for pagination tests
function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    label: `Item ${String(i + 1).padStart(3, "0")}`,
    value: (i + 1) * 10,
  }));
}

const baseEnvelope: ResultEnvelope = {
  messageId: "m4",
  queryType: "sql",
  chartType: "table",
  columns: [
    { name: "region", type: "string", role: "dimension" },
    { name: "revenue", type: "number", role: "measure" },
  ],
  rows: [
    { region: "North", revenue: 1200 },
    { region: "South", revenue: 800 },
    { region: "East", revenue: 2400 },
  ],
  rowCount: 3,
  truncated: false,
};

describe("DataTable — structure", () => {
  it("renders a table with caption", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    // caption is sr-only but still in DOM
    expect(document.querySelector("caption")).toHaveTextContent("Query results");
  });

  it("renders th elements with scope=col", () => {
    render(<DataTable envelope={baseEnvelope} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    headers.forEach((th) => expect(th).toHaveAttribute("scope", "col"));
  });

  it("renders column names as header text", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByRole("columnheader", { name: /region/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /revenue/i })).toBeInTheDocument();
  });

  it("renders row data correctly with number formatting", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument();
  });

  it("renders null values as em-dash", () => {
    const env: ResultEnvelope = {
      ...baseEnvelope,
      rows: [{ region: null, revenue: null }],
      rowCount: 1,
    };
    render(<DataTable envelope={env} />);
    const dashes = screen.getAllByText("–");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when rows is empty", () => {
    const env: ResultEnvelope = { ...baseEnvelope, rows: [], rowCount: 0 };
    render(<DataTable envelope={env} />);
    expect(screen.getByText(/no data returned for this query/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("accepts custom caption prop", () => {
    render(<DataTable envelope={baseEnvelope} caption="Revenue by region" />);
    expect(document.querySelector("caption")).toHaveTextContent("Revenue by region");
  });

  it("shows pagination label", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByText(/Showing 1–3 of 3 results/i)).toBeInTheDocument();
  });
});

describe("DataTable — sorting", () => {
  it("sets aria-sort=none on unsorted headers", () => {
    render(<DataTable envelope={baseEnvelope} />);
    const regionHeader = screen.getByRole("columnheader", { name: /region/i });
    expect(regionHeader).toHaveAttribute("aria-sort", "none");
  });

  it("sorts ascending on first click and updates aria-sort", async () => {
    const user = userEvent.setup();
    render(<DataTable envelope={baseEnvelope} />);
    const revenueHeader = screen.getByRole("columnheader", { name: /revenue/i });

    await user.click(revenueHeader);

    expect(revenueHeader).toHaveAttribute("aria-sort", "ascending");
    const rows = screen.getAllByRole("row");
    // header row + 3 data rows
    expect(rows).toHaveLength(4);
    // First data row should be smallest revenue (800)
    expect(within(rows[1]).getByText("800")).toBeInTheDocument();
  });

  it("sorts descending on second click", async () => {
    const user = userEvent.setup();
    render(<DataTable envelope={baseEnvelope} />);
    const revenueHeader = screen.getByRole("columnheader", { name: /revenue/i });

    await user.click(revenueHeader);
    await user.click(revenueHeader);

    expect(revenueHeader).toHaveAttribute("aria-sort", "descending");
    const rows = screen.getAllByRole("row");
    // First data row should be largest revenue (2400)
    expect(within(rows[1]).getByText("2,400")).toBeInTheDocument();
  });

  it("sorts strings alphabetically", async () => {
    const user = userEvent.setup();
    render(<DataTable envelope={baseEnvelope} />);
    const regionHeader = screen.getByRole("columnheader", { name: /region/i });

    await user.click(regionHeader);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("East")).toBeInTheDocument();
    expect(within(rows[2]).getByText("North")).toBeInTheDocument();
    expect(within(rows[3]).getByText("South")).toBeInTheDocument();
  });
});

describe("DataTable — pagination", () => {
  it("shows page size selector with options 20, 50, 100", () => {
    const env: ResultEnvelope = {
      ...baseEnvelope,
      columns: [
        { name: "id", type: "integer", role: "measure" },
        { name: "label", type: "string", role: "dimension" },
        { name: "value", type: "number", role: "measure" },
      ],
      rows: makeRows(50),
      rowCount: 50,
    };
    render(<DataTable envelope={env} />);
    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["20", "50", "100"]);
  });

  it("shows first 20 rows by default on a 50-row dataset", () => {
    const env: ResultEnvelope = {
      ...baseEnvelope,
      columns: [
        { name: "id", type: "integer", role: "measure" },
        { name: "label", type: "string", role: "dimension" },
        { name: "value", type: "number", role: "measure" },
      ],
      rows: makeRows(50),
      rowCount: 50,
    };
    render(<DataTable envelope={env} />);
    expect(screen.getByText(/Showing 1–20 of 50 results/i)).toBeInTheDocument();
    // First row visible
    expect(screen.getByText("Item 001")).toBeInTheDocument();
    // Row 21 not visible
    expect(screen.queryByText("Item 021")).not.toBeInTheDocument();
  });

  it("navigates to page 2 with next button", async () => {
    const user = userEvent.setup();
    const env: ResultEnvelope = {
      ...baseEnvelope,
      columns: [
        { name: "id", type: "integer", role: "measure" },
        { name: "label", type: "string", role: "dimension" },
        { name: "value", type: "number", role: "measure" },
      ],
      rows: makeRows(50),
      rowCount: 50,
    };
    render(<DataTable envelope={env} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getByText(/Showing 21–40 of 50 results/i)).toBeInTheDocument();
    expect(screen.getByText("Item 021")).toBeInTheDocument();
    expect(screen.queryByText("Item 001")).not.toBeInTheDocument();
  });

  it("previous button disabled on first page", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
  });

  it("next button disabled on last page", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
  });

  it("changes page size to 50", async () => {
    const user = userEvent.setup();
    const env: ResultEnvelope = {
      ...baseEnvelope,
      columns: [
        { name: "id", type: "integer", role: "measure" },
        { name: "label", type: "string", role: "dimension" },
        { name: "value", type: "number", role: "measure" },
      ],
      rows: makeRows(60),
      rowCount: 60,
    };
    render(<DataTable envelope={env} />);

    await user.selectOptions(screen.getByRole("combobox"), "50");
    expect(screen.getByText(/Showing 1–50 of 60 results/i)).toBeInTheDocument();
    expect(screen.getByText("Item 050")).toBeInTheDocument();
    expect(screen.queryByText("Item 051")).not.toBeInTheDocument();
  });
});

describe("DataTable — large result / a11y", () => {
  it("shows large-result banner when truncated=true", () => {
    const env: ResultEnvelope = { ...baseEnvelope, truncated: true, rowCount: 5000 };
    render(<DataTable envelope={env} />);
    expect(screen.getByRole("status")).toHaveTextContent(/5,000 rows/i);
  });

  it("does not show banner for small result", () => {
    render(<DataTable envelope={baseEnvelope} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
