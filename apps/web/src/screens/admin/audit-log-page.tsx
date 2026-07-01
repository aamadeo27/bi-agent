import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditEvent, AuditEventType } from "@bi/contracts";
import { getAuditLog, listDataSources } from "../../lib/api-client";
import type { AuditLogParams } from "../../lib/api-client";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  query_executed: "Query executed",
  query_blocked: "Query blocked",
  query_validation_failed: "Validation failed",
  export: "Export",
  role_changed: "Role changed",
  permission_changed: "Permission changed",
  user_role_assigned: "User role assigned",
  data_source_changed: "Data source changed",
  login: "Login",
  login_failed: "Login failed",
};

const ALL_EVENT_TYPES: AuditEventType[] = Object.keys(EVENT_TYPE_LABELS) as AuditEventType[];

// ─── Status badge (color + icon + text — never color alone) ──────────────────

function OutcomeBadge({ outcome }: { outcome: AuditEvent["outcome"] }) {
  const config: Record<
    AuditEvent["outcome"],
    { icon: string; label: string; classes: string }
  > = {
    success: {
      icon: "✓",
      label: "Success",
      classes: "bg-semantic-success/15 text-semantic-success",
    },
    blocked: {
      icon: "⊘",
      label: "Blocked",
      classes: "bg-amber-100 text-amber-700",
    },
    error: {
      icon: "✗",
      label: "Error",
      classes: "bg-semantic-error/15 text-semantic-error",
    },
  };
  const { icon, label, classes } = config[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-body-sm font-semibold ${classes}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

// ─── Detail panel (row expand) ────────────────────────────────────────────────

function DetailPanel({ event }: { event: AuditEvent }) {
  const queryText =
    typeof event.detail.queryText === "string" ? event.detail.queryText : null;
  const missing = Array.isArray(event.detail.missing)
    ? (event.detail.missing as unknown[])
    : null;

  return (
    <div className="bg-neutral-50 px-6 py-4 text-body text-neutral-700">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-body-sm font-semibold text-neutral-500">Event ID</dt>
          <dd className="font-mono text-body-sm text-neutral-700 break-all">{event.id}</dd>
        </div>
        <div>
          <dt className="text-body-sm font-semibold text-neutral-500">Role at event</dt>
          <dd>{event.roleNameAtEvent}</dd>
        </div>
        <div>
          <dt className="text-body-sm font-semibold text-neutral-500">IP address</dt>
          <dd>{event.ip ?? <span className="italic text-neutral-400">—</span>}</dd>
        </div>
        <div>
          <dt className="text-body-sm font-semibold text-neutral-500">Outcome</dt>
          <dd>
            <OutcomeBadge outcome={event.outcome} />
          </dd>
        </div>
        {event.dataSourceId && (
          <div>
            <dt className="text-body-sm font-semibold text-neutral-500">Data source ID</dt>
            <dd className="font-mono text-body-sm">{event.dataSourceId}</dd>
          </div>
        )}
        {queryText && (
          <div className="sm:col-span-2">
            <dt className="text-body-sm font-semibold text-neutral-500">Query text</dt>
            <dd>
              <pre className="mt-1 overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 font-mono text-body-sm text-neutral-900 whitespace-pre-wrap break-all">
                {queryText}
              </pre>
            </dd>
          </div>
        )}
        {missing && missing.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-body-sm font-semibold text-neutral-500">
              Missing permissions
            </dt>
            <dd>
              <ul className="mt-1 list-disc list-inside text-body-sm text-semantic-error">
                {missing.map((m) => (
                  <li key={String(m)}>{String(m)}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-body-sm font-semibold text-neutral-500">Full detail</dt>
          <dd>
            <pre className="mt-1 overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 font-mono text-body-sm text-neutral-700 whitespace-pre-wrap break-all">
              {JSON.stringify(event.detail, null, 2)}
            </pre>
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Event type multi-select ──────────────────────────────────────────────────

interface EventTypeSelectProps {
  selected: AuditEventType[];
  onChange: (types: AuditEventType[]) => void;
}

function EventTypeSelect({ selected, onChange }: EventTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function toggle(type: AuditEventType) {
    if (selected.includes(type)) {
      onChange(selected.filter((t) => t !== type));
    } else {
      onChange([...selected, type]);
    }
  }

  const label =
    selected.length === 0
      ? "All event types"
      : selected.length === 1
        ? EVENT_TYPE_LABELS[selected[0]]
        : `${selected.length} types selected`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by event type"
        className="flex min-w-[180px] items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-700
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
          hover:border-neutral-400"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="shrink-0 text-neutral-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label="Event types"
          className="absolute z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {ALL_EVENT_TYPES.map((type) => {
            const isChecked = selected.includes(type);
            return (
              <div
                key={type}
                role="option"
                aria-selected={isChecked}
                onClick={() => toggle(type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(type);
                  }
                }}
                tabIndex={0}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-body text-neutral-700
                  hover:bg-primary-50 focus-visible:outline-none focus-visible:bg-primary-50"
              >
                <input
                  type="checkbox"
                  tabIndex={-1}
                  readOnly
                  checked={isChecked}
                  aria-hidden="true"
                  className="h-4 w-4 rounded border-neutral-300 text-primary-600 accent-primary-600 pointer-events-none"
                />
                <span>{EVENT_TYPE_LABELS[type]}</span>
              </div>
            );
          })}
          {selected.length > 0 && (
            <div className="border-t border-neutral-100 px-3 py-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-body-sm text-primary-600 hover:underline focus-visible:outline-none"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportToCsv(events: AuditEvent[]) {
  const headers = [
    "Timestamp",
    "User ID",
    "Role at event",
    "Event type",
    "Outcome",
    "Data source ID",
    "IP",
    "Detail",
  ];
  const rows = events.map((e) => [
    e.at,
    e.actorUserId,
    e.roleNameAtEvent,
    EVENT_TYPE_LABELS[e.type] ?? e.type,
    e.outcome,
    e.dataSourceId ?? "",
    e.ip ?? "",
    JSON.stringify(e.detail),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface Filters {
  from: string;
  to: string;
  types: AuditEventType[];
  userId: string;
  dataSourceId: string;
}

interface FilterBarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  dataSources: { id: string; name: string }[];
}

function FilterBar({ filters, onChange, dataSources }: FilterBarProps) {
  return (
    <div
      role="search"
      aria-label="Audit log filters"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3"
    >
      {/* Date from */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="audit-filter-from"
          className="text-body-sm font-semibold text-neutral-600"
        >
          From
        </label>
        <input
          id="audit-filter-from"
          type="date"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="audit-filter-to"
          className="text-body-sm font-semibold text-neutral-600"
        >
          To
        </label>
        <input
          id="audit-filter-to"
          type="date"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
        />
      </div>

      {/* Event type multi-select */}
      <div className="flex flex-col gap-1">
        <span className="text-body-sm font-semibold text-neutral-600">
          Event type
        </span>
        <EventTypeSelect
          selected={filters.types}
          onChange={(types) => onChange({ ...filters, types })}
        />
      </div>

      {/* User search */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="audit-filter-user"
          className="text-body-sm font-semibold text-neutral-600"
        >
          User ID
        </label>
        <input
          id="audit-filter-user"
          type="search"
          placeholder="Filter by user ID…"
          value={filters.userId}
          onChange={(e) => onChange({ ...filters, userId: e.target.value })}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 placeholder:text-neutral-400
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
        />
      </div>

      {/* Data source filter */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="audit-filter-datasource"
          className="text-body-sm font-semibold text-neutral-600"
        >
          Data source
        </label>
        <select
          id="audit-filter-datasource"
          value={filters.dataSourceId}
          onChange={(e) => onChange({ ...filters, dataSourceId: e.target.value })}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
        >
          <option value="">All data sources</option>
          {dataSources.map((ds) => (
            <option key={ds.id} value={ds.id}>
              {ds.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Pagination controls ──────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}

function Pagination({ page, total, pageSize, onPage }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-body text-neutral-600">
      <p aria-live="polite" aria-atomic="true">
        {total === 0 ? "0 results" : `Showing ${start}–${end} of ${total}`}
      </p>
      <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-body-sm font-medium text-neutral-700
            transition-colors hover:bg-neutral-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-body-sm text-neutral-600" aria-current="page">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-body-sm font-medium text-neutral-700
            transition-colors hover:bg-neutral-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Event table row ──────────────────────────────────────────────────────────

interface EventRowProps {
  event: AuditEvent;
  isExpanded: boolean;
  onToggle: () => void;
  dataSourceName: string | undefined;
}

function EventRow({ event, isExpanded, onToggle, dataSourceName }: EventRowProps) {
  const ts = new Date(event.at).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  const description = buildDescription(event);

  return (
    <>
      <tr
        className={`border-b border-neutral-100 cursor-pointer transition-colors ${isExpanded ? "bg-primary-50" : "hover:bg-neutral-50"}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} event ${event.id}`}
            className="mr-2 shrink-0 rounded p-0.5 text-neutral-400 hover:text-primary-600
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
          </button>
          <time
            dateTime={event.at}
            className="font-mono text-body-sm text-neutral-700"
          >
            {ts}
          </time>
        </td>
        <td className="px-4 py-3 text-body text-neutral-700 font-mono text-body-sm">
          {event.actorUserId}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center rounded-full border border-neutral-200 px-2 py-0.5 text-body-sm text-neutral-700">
            {EVENT_TYPE_LABELS[event.type] ?? event.type}
          </span>
        </td>
        <td className="max-w-xs px-4 py-3 text-body text-neutral-700">
          <span className="block truncate" title={description}>
            {description}
          </span>
        </td>
        <td className="px-4 py-3 text-body-sm text-neutral-600">
          {dataSourceName ?? (event.dataSourceId ? (
            <span className="font-mono text-body-sm">{event.dataSourceId}</span>
          ) : (
            <span className="italic text-neutral-400">—</span>
          ))}
        </td>
        <td className="px-4 py-3">
          <OutcomeBadge outcome={event.outcome} />
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td
            colSpan={6}
            className="border-b border-neutral-200 p-0"
          >
            <DetailPanel event={event} />
          </td>
        </tr>
      )}
    </>
  );
}

function buildDescription(event: AuditEvent): string {
  switch (event.type) {
    case "query_executed":
      return typeof event.detail.queryText === "string"
        ? event.detail.queryText.slice(0, 120)
        : "Query executed";
    case "query_blocked": {
      const missing = Array.isArray(event.detail.missing)
        ? event.detail.missing.slice(0, 3).join(", ")
        : "";
      return missing ? `Blocked — missing: ${missing}` : "Query blocked";
    }
    case "query_validation_failed":
      return typeof event.detail.reason === "string"
        ? event.detail.reason
        : "Query validation failed";
    case "export":
      return "Exported results";
    case "role_changed":
      return typeof event.detail.roleName === "string"
        ? `Role changed to "${event.detail.roleName}"`
        : "Role changed";
    case "permission_changed":
      return "Permission set updated";
    case "user_role_assigned":
      return typeof event.detail.targetUserId === "string"
        ? `Role assigned to user ${event.detail.targetUserId}`
        : "User role assigned";
    case "data_source_changed":
      return "Data source configuration updated";
    case "login":
      return "Successful login";
    case "login_failed":
      return "Login attempt failed";
    default:
      return event.type;
  }
}

// Pure helper — looks up a data source name by id from a list.
function lookupDsName(
  id: string | undefined,
  sources: { id: string; name: string }[],
): string | undefined {
  if (!id) return undefined;
  return sources.find((ds) => ds.id === id)?.name;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AuditLogPage() {
  const [filters, setFilters] = useState<Filters>({
    from: "",
    to: "",
    types: [],
    userId: "",
    dataSourceId: "",
  });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    setPage(1); // Reset to page 1 when filters change
    setExpandedId(null);
  }, []);

  const queryParams: AuditLogParams = {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.types.length ? { type: filters.types } : {}),
    ...(filters.userId.trim() ? { userId: filters.userId.trim() } : {}),
    ...(filters.dataSourceId ? { dataSourceId: filters.dataSourceId } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const auditQuery = useQuery({
    queryKey: ["adminAudit", queryParams],
    queryFn: () => getAuditLog(queryParams),
    retry: false,
  });

  const dsQuery = useQuery({
    queryKey: ["dataSources"],
    queryFn: listDataSources,
    retry: false,
  });

  const data = auditQuery.data;
  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const dataSources = dsQuery.data ?? [];

  async function handleExport() {
    setIsExporting(true);
    try {
      // Fetch all filtered results (no pagination) for a complete export
      const allParams: AuditLogParams = {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.types.length ? { type: filters.types } : {}),
        ...(filters.userId.trim() ? { userId: filters.userId.trim() } : {}),
        ...(filters.dataSourceId ? { dataSourceId: filters.dataSourceId } : {}),
        page: 1,
        pageSize: 10_000,
      };
      const result = await getAuditLog(allParams);
      exportToCsv(result.events);
    } finally {
      setIsExporting(false);
    }
  }

  const isLoading = auditQuery.isPending;
  const isError = auditQuery.isError;
  const isEmpty = !isLoading && !isError && events.length === 0;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-heading-1 text-neutral-900">Audit Log</h1>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={events.length === 0 || isExporting}
          aria-disabled={events.length === 0 || isExporting}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-body font-medium text-neutral-700
            transition-colors hover:bg-neutral-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">↓</span>
          {isExporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <FilterBar
          filters={filters}
          onChange={handleFiltersChange}
          dataSources={dataSources}
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <p
          role="status"
          aria-live="polite"
          className="py-8 text-center text-body text-neutral-500"
        >
          Loading audit events…
        </p>
      )}

      {/* Error */}
      {isError && (
        <p
          role="alert"
          className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3 text-body text-semantic-error"
        >
          Failed to load audit log. Please refresh the page.
        </p>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-white py-16 text-center">
          <p className="mb-2 text-body-lg font-semibold text-neutral-700">
            No events match your filters.
          </p>
          <p className="text-body text-neutral-500">
            {Object.values(filters).some((v) =>
              Array.isArray(v) ? v.length > 0 : v !== "",
            )
              ? "Try adjusting or clearing your filters."
              : "Audit logging will appear here as users interact with the system."}
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && events.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left" aria-label="Audit events">
              <caption className="sr-only">
                Audit log — {total} event{total !== 1 ? "s" : ""}
              </caption>
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Timestamp
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    User
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Event type
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Description
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Data source
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    isExpanded={expandedId === event.id}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === event.id ? null : event.id))
                    }
                    dataSourceName={lookupDsName(event.dataSourceId, dataSources)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  );
}
