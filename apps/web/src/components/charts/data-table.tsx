import { useState, useMemo, type ChangeEvent } from "react";
import type { ResultEnvelope } from "@bi/contracts";
import { formatValue } from "./chart-utils";
import { EmptyState } from "./empty-state";
import { LargeResultBanner } from "./large-result-banner";
import { LARGE_RESULT_THRESHOLD } from "./chart-palette";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type SortDir = "asc" | "desc";

interface DataTableProps {
  envelope: ResultEnvelope;
  /** Optional caption override; defaults to "Query results". */
  caption?: string;
}

export function DataTable({ envelope, caption = "Query results" }: DataTableProps) {
  const { columns, rows, rowCount, truncated } = envelope;

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(20);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return sortDir === "asc" ? 1 : -1;
      if (bv === null) return sortDir === "asc" ? -1 : 1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const firstRow = sortedRows.length === 0 ? 0 : safePage * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize + pageSize, sortedRows.length);

  function handleSort(colName: string) {
    if (sortKey === colName) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colName);
      setSortDir("asc");
    }
    setPage(0);
  }

  function handlePageSizeChange(e: ChangeEvent<HTMLSelectElement>) {
    setPageSize(Number(e.target.value) as PageSize);
    setPage(0);
  }

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const showBanner = truncated || rowCount > LARGE_RESULT_THRESHOLD;

  return (
    <div className="flex flex-col gap-2">
      {showBanner && <LargeResultBanner rowCount={rowCount} />}

      <div className="overflow-x-auto rounded border border-neutral-300">
        <table className="min-w-full text-sm text-neutral-900">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-neutral-50 text-left">
            <tr>
              {columns.map((col) => {
                const isActive = sortKey === col.name;
                return (
                  <th
                    key={col.name}
                    scope="col"
                    className="min-w-[80px] cursor-pointer select-none whitespace-nowrap border-b border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                    onClick={() => handleSort(col.name)}
                    aria-sort={
                      isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <span className="flex items-center gap-1">
                      {col.name}
                      {isActive ? (
                        <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                      ) : (
                        <span aria-hidden="true" className="opacity-30">▲</span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIdx) => {
              // Content-stable key: join all column values so React reorders DOM on sort
              // rather than updating in-place. Disambiguate true duplicate rows with index.
              const rowKey =
                columns.map((col) => String(row[col.name] ?? "")).join("||") +
                "||" +
                rowIdx;
              return (
              <tr
                key={rowKey}
                className={rowIdx % 2 === 0 ? "bg-white" : "bg-neutral-100"}
              >
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className="whitespace-nowrap border-b border-neutral-200 px-3 py-2"
                  >
                    {formatValue(row[col.name])}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="flex items-center justify-between gap-4 px-1 text-sm text-neutral-700">
        <span>
          Showing {firstRow}–{lastRow} of {rowCount.toLocaleString("en-US")} results
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            Rows per page:
            <select
              value={pageSize}
              onChange={handlePageSizeChange}
              className="ml-1 rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary-500"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="min-w-[60px] text-center text-xs">
              {safePage + 1} / {totalPages}
            </span>
            <button
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary-500"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
