import { useState, useMemo } from "react";
import type { ResultEnvelope } from "@bi/contracts";

interface Props {
  envelope: ResultEnvelope;
}

type SortDir = "asc" | "desc";

const PAGE_SIZES = [20, 50, 100] as const;

function formatCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v;
}

export function DataTableView({ envelope }: Props) {
  const { columns, rows } = envelope;

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null && bv === null) return 0;
      if (av === null) return sortDir === "asc" ? 1 : -1;
      if (bv === null) return sortDir === "asc" ? -1 : 1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [rows, sortCol, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setPage(0);
  }

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, sorted.length);

  return (
    <div className="w-full overflow-auto" data-testid="data-table">
      <table className="w-full border-collapse text-body" aria-label="Query results">
        <caption className="sr-only">
          Query results: {sorted.length} rows, {columns.length} columns
        </caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.name}
                scope="col"
                className="text-heading-3 text-left px-3 py-2 bg-neutral-100 border-b border-neutral-300 min-w-[80px] cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort(col.name)}
                aria-sort={
                  sortCol === col.name
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.name}
                  {sortCol === col.name && (
                    <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-neutral-500"
              >
                No data returned for this query.
              </td>
            </tr>
          ) : (
            pageRows.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? "bg-white" : "bg-neutral-100"}
              >
                {columns.map((col) => (
                  <td key={col.name} className="px-3 py-2 text-neutral-900">
                    {formatCell(row[col.name] ?? null)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination bar */}
      {sorted.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-300 text-body-sm text-neutral-700">
          <span>
            Showing {start}–{end} of {sorted.length} results
          </span>
          <div className="flex items-center gap-3">
            <label htmlFor="page-size-select" className="sr-only">
              Rows per page
            </label>
            <select
              id="page-size-select"
              className="border border-neutral-300 rounded-sm px-2 py-1 text-body-sm"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} / page
                </option>
              ))}
            </select>
            <button
              className="px-2 py-1 rounded-sm border border-neutral-300 disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <select
              aria-label="Go to page"
              className="border border-neutral-300 rounded-sm px-2 py-1 text-body-sm"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {Array.from({ length: totalPages }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
            <button
              className="px-2 py-1 rounded-sm border border-neutral-300 disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
