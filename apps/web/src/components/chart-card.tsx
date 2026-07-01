import { useState, useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ResultEnvelope } from "@bi/contracts";
import {
  BarChart,
  LineChart,
  PieChart,
  DataTable,
  LARGE_RESULT_THRESHOLD,
} from "./charts";

// ─── Export helpers ──────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportChartAsImage(
  container: HTMLElement,
  format: "png" | "jpeg",
  messageId: string
): Promise<void> {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No chart SVG found");

  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = svg.clientWidth || 800;
      canvas.height = svg.clientHeight || 400;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(svgUrl);
        reject(new Error("Canvas context unavailable"));
        return;
      }
      if (format === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob returned null"));
            return;
          }
          downloadBlob(blob, `bi-export-${messageId}.${format}`);
          resolve();
        },
        `image/${format}`
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error("SVG image load failed"));
    };
    img.src = svgUrl;
  });
}

/**
 * Prefix cell values that start with formula-trigger characters so spreadsheet
 * apps (Excel, Sheets) treat them as text rather than executing a formula. CWE-1236.
 */
function sanitizeCsvCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function exportAsCsv(envelope: ResultEnvelope): void {
  const headers = envelope.columns.map((c) => c.name);
  const csvLines = [
    headers.map((h) => JSON.stringify(h)).join(","),
    ...envelope.rows.map((row) =>
      headers
        .map((h) => {
          const v = row[h] ?? null;
          if (v === null) return "";
          if (typeof v === "string") return JSON.stringify(sanitizeCsvCell(v));
          return String(v);
        })
        .join(",")
    ),
  ];
  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `bi-export-${envelope.messageId}.csv`);
}

function exportAsJson(envelope: ResultEnvelope): void {
  // Compact JSON — pretty-printing at 5 000-row threshold costs 3-4× memory and blocks the main thread.
  const blob = new Blob([JSON.stringify(envelope.rows)], {
    type: "application/json",
  });
  downloadBlob(blob, `bi-export-${envelope.messageId}.json`);
}

// ─── Badge label ─────────────────────────────────────────────────────────────

const BADGE_LABELS: Record<ResultEnvelope["chartType"], string> = {
  bar: "Bar chart",
  line: "Line chart",
  pie: "Pie chart",
  table: "Table",
};

// ─── Chart body ──────────────────────────────────────────────────────────────

function ChartBody({ envelope }: { envelope: ResultEnvelope }) {
  switch (envelope.chartType) {
    case "bar":
      return (
        <div data-testid="bar-chart">
          <BarChart envelope={envelope} />
        </div>
      );
    case "line":
      return (
        <div data-testid="line-chart">
          <LineChart envelope={envelope} />
        </div>
      );
    case "pie":
      return (
        <div data-testid="pie-chart">
          <PieChart envelope={envelope} />
        </div>
      );
    default:
      return null;
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ChartCardProps {
  envelope: ResultEnvelope;
  /** When true, renders a skeleton loading placeholder instead of chart content. */
  isLoading?: boolean;
}

// ─── ChartCard ───────────────────────────────────────────────────────────────

export function ChartCard({ envelope, isLoading = false }: ChartCardProps) {
  const isTableType = envelope.chartType === "table";
  const [viewMode, setViewMode] = useState<"chart" | "table">(
    isTableType ? "table" : "chart"
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showLargeWarning, setShowLargeWarning] = useState(false);
  const [pendingExport, setPendingExport] = useState<
    null | "png" | "jpeg" | "csv" | "json"
  >(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const showInTable = viewMode === "table" || isTableType;
  const isLarge = envelope.rowCount > LARGE_RESULT_THRESHOLD;

  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  function handleExportSelect(format: "png" | "jpeg" | "csv" | "json") {
    if (isLarge && (format === "csv" || format === "json")) {
      setPendingExport(format);
      setShowLargeWarning(true);
      return;
    }
    void runExport(format);
  }

  async function runExport(format: "png" | "jpeg" | "csv" | "json") {
    setExportError(null);
    toast("Preparing export...");
    try {
      if (format === "csv") {
        exportAsCsv(envelope);
      } else if (format === "json") {
        exportAsJson(envelope);
      } else if (chartRef.current) {
        await exportChartAsImage(chartRef.current, format, envelope.messageId);
      }
      toast(`Exported as bi-export-${envelope.messageId}.${format}`);
    } catch {
      setExportError("Export failed. Please try again.");
      setToastMsg(null);
    }
  }

  function confirmLargeExport() {
    setShowLargeWarning(false);
    if (pendingExport) {
      void runExport(pendingExport);
      setPendingExport(null);
    }
  }

  function cancelLargeExport() {
    setShowLargeWarning(false);
    setPendingExport(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="bg-white border border-neutral-300 rounded-lg p-5 shadow-[0_1px_4px_rgba(0,0,0,0.08)] w-full min-h-[280px]"
      data-testid="chart-card"
      data-message-id={envelope.messageId}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        {/* Chart-type badge (read-only) */}
        <span
          className="text-label bg-neutral-100 text-neutral-700 rounded-full px-3 py-1"
          aria-label={`Chart type: ${BADGE_LABELS[envelope.chartType]}`}
        >
          {BADGE_LABELS[envelope.chartType]}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-2" role="group" aria-label="Chart controls">
          {/* Toggle — hidden when server selected table type */}
          {!isTableType && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 text-body-sm text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-3 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode((m) => (m === "chart" ? "table" : "chart"))}
              data-testid="toggle-view-btn"
            >
              {viewMode === "chart" ? (
                <>
                  <TableIcon className="w-4 h-4" aria-hidden="true" />
                  Table view
                </>
              ) : (
                <>
                  <BarIcon className="w-4 h-4" aria-hidden="true" />
                  Chart view
                </>
              )}
            </button>
          )}

          {/* Export popover */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 text-body-sm text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-3 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                data-testid="export-btn"
              >
                <DownloadIcon className="w-4 h-4" aria-hidden="true" />
                Export
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 bg-white border border-neutral-300 rounded-lg shadow-lg py-1 min-w-[160px]"
                align="end"
                sideOffset={4}
                data-testid="export-popover"
              >
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-body-sm text-neutral-700 cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none"
                  onSelect={() => handleExportSelect("png")}
                  data-testid="export-png"
                >
                  <ImageIcon className="w-4 h-4" aria-hidden="true" />
                  Chart as PNG
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-body-sm text-neutral-700 cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none"
                  onSelect={() => handleExportSelect("jpeg")}
                  data-testid="export-jpeg"
                >
                  <ImageIcon className="w-4 h-4" aria-hidden="true" />
                  Chart as JPEG
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-neutral-300 my-1" />
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-body-sm text-neutral-700 cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none"
                  onSelect={() => handleExportSelect("csv")}
                  data-testid="export-csv"
                >
                  <TableIcon className="w-4 h-4" aria-hidden="true" />
                  Data as CSV
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-body-sm text-neutral-700 cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none"
                  onSelect={() => handleExportSelect("json")}
                  data-testid="export-json"
                >
                  <TableIcon className="w-4 h-4" aria-hidden="true" />
                  Data as JSON
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Notes banner (e.g. "downgraded to table: >2000 rows") */}
      {envelope.notes && (
        <div
          role="note"
          className="mb-3 flex items-start gap-2 rounded-md bg-neutral-100 border border-neutral-300 px-3 py-2 text-body-sm text-neutral-700"
          data-testid="notes-banner"
        >
          <InfoIcon className="w-4 h-4 mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" />
          <span>{envelope.notes}</span>
        </div>
      )}

      {/* Chart / table body */}
      <div ref={chartRef}>
        {isLoading ? (
          <div
            className="w-full h-48 rounded-md bg-neutral-100 animate-pulse"
            role="status"
            aria-label="Loading chart..."
            data-testid="chart-skeleton"
          />
        ) : showInTable ? (
          <div data-testid="data-table">
            <DataTable envelope={envelope} />
          </div>
        ) : (
          <ChartBody envelope={envelope} />
        )}
      </div>

      {/* Large-export warning dialog */}
      {showLargeWarning && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="large-export-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="large-export-warning"
        >
          <div className="bg-white rounded-lg border border-neutral-300 shadow-lg p-6 max-w-sm w-full mx-4">
            <h2
              id="large-export-title"
              className="text-heading-2 text-neutral-900 mb-2"
            >
              Large export
            </h2>
            <p className="text-body text-neutral-700 mb-4">
              This export contains{" "}
              <strong>{envelope.rowCount.toLocaleString()}</strong> rows and
              may be large. Continue?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-md border border-neutral-300 text-body-sm text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-3 focus-visible:ring-primary-500"
                onClick={cancelLargeExport}
                data-testid="large-export-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-primary-500 text-body-sm text-white hover:bg-primary-600 focus:outline-none focus-visible:ring-3 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                onClick={confirmLargeExport}
                data-testid="large-export-confirm"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export error */}
      {exportError && (
        <div
          role="alert"
          className="mt-3 text-body-sm text-semantic-error"
          data-testid="export-error"
        >
          {exportError}
        </div>
      )}

      {/* Toast notification */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 bg-neutral-900 text-white text-body-sm rounded-lg px-4 py-2 shadow-lg"
          data-testid="export-toast"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function TableIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  );
}

function BarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
