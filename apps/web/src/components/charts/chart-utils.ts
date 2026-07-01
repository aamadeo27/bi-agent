import type { ResultEnvelope } from "@bi/contracts";

/** Format a cell value: null → em-dash, numbers → locale string (2dp max), else string. */
export function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "number") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(value);
}

/** Build a summary aria-label for a chart SVG wrapper. */
export function buildChartAriaLabel(
  chartType: "bar" | "line" | "pie" | "table",
  columns: ResultEnvelope["columns"],
  shownRows: number,
): string {
  const type = chartType.charAt(0).toUpperCase() + chartType.slice(1);
  const measures = columns
    .filter((c) => c.role === "measure")
    .map((c) => c.name)
    .join(", ");
  const dims = columns
    .filter((c) => c.role === "dimension" || c.role === "time")
    .map((c) => c.name)
    .join(", ");
  const subject = measures || "values";
  const by = dims ? ` by ${dims}` : "";
  return `${type} chart: ${subject}${by}. ${shownRows} data point${shownRows !== 1 ? "s" : ""}. Use the Table view button to see the full data.`;
}
