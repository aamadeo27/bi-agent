import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Toast from "@radix-ui/react-toast";
import type {
  Role,
  ResourceGrantSet,
  SchemaTree,
  SchemaSchemaObj,
} from "@bi/contracts";
import {
  listRoles,
  listRoleGrants,
  putRoleGrants,
  getSchemaTree,
  listDataSources,
} from "../../lib/api-client";

// ─── Grant-set helpers ────────────────────────────────────────────────────────

function schKey(s: string) {
  return `sch:${s}`;
}
function tblKey(s: string, t: string) {
  return `tbl:${s}/${t}`;
}
function colKey(s: string, t: string, c: string) {
  return `col:${s}/${t}/${c}`;
}

function isColGranted(gs: Set<string>, s: string, t: string, c: string) {
  return gs.has(colKey(s, t, c)) || gs.has(tblKey(s, t)) || gs.has(schKey(s));
}

type GrantState = "all" | "some" | "none";

function tableGrantState(
  gs: Set<string>,
  s: string,
  t: string,
  cols: string[],
): GrantState {
  if (gs.has(schKey(s)) || gs.has(tblKey(s, t))) return "all";
  if (cols.length === 0) return "none";
  const cnt = cols.filter((c) => gs.has(colKey(s, t, c))).length;
  if (cnt === cols.length) return "all";
  if (cnt > 0) return "some";
  return "none";
}

function schemaGrantState(
  gs: Set<string>,
  s: string,
  tables: Array<{ name: string; cols: string[] }>,
): GrantState {
  if (gs.has(schKey(s))) return "all";
  if (tables.length === 0) return "none";
  const states = tables.map((t) => tableGrantState(gs, s, t.name, t.cols));
  if (states.every((st) => st === "all")) return "all";
  if (states.some((st) => st !== "none")) return "some";
  return "none";
}

function grantsToSet(grants: ResourceGrantSet, dsId: string): Set<string> {
  const set = new Set<string>();
  for (const g of grants) {
    if (g.dataSourceId !== dsId) continue;
    if (g.kind === "schema") set.add(schKey(g.schema));
    else if (g.kind === "table") set.add(tblKey(g.schema, g.table!));
    else set.add(colKey(g.schema, g.table!, g.column!));
  }
  return set;
}

function setToGrants(
  grantSet: Set<string>,
  roleId: string,
  dsId: string,
): ResourceGrantSet {
  const grants: ResourceGrantSet = [];
  for (const key of grantSet) {
    if (key.startsWith("sch:")) {
      grants.push({
        roleId,
        dataSourceId: dsId,
        kind: "schema",
        schema: key.slice(4),
      });
    } else if (key.startsWith("tbl:")) {
      const [schema, table] = key.slice(4).split("/");
      grants.push({ roleId, dataSourceId: dsId, kind: "table", schema, table });
    } else if (key.startsWith("col:")) {
      const [schema, table, column] = key.slice(4).split("/");
      grants.push({
        roleId,
        dataSourceId: dsId,
        kind: "column",
        schema,
        table,
        column,
      });
    }
  }
  return grants;
}

// ─── Grant toggle logic ───────────────────────────────────────────────────────

function toggleColGrant(
  gs: Set<string>,
  schema: string,
  table: string,
  col: string,
  allSchemas: SchemaSchemaObj[],
): Set<string> {
  const set = new Set(gs);
  const schObj = allSchemas.find((s) => s.name === schema);
  const tblObj = schObj?.tables.find((t) => t.name === table);
  if (!tblObj) return set;
  const allCols = tblObj.columns.map((c) => c.name);
  const granted = isColGranted(gs, schema, table, col);

  if (granted) {
    if (set.has(schKey(schema))) {
      set.delete(schKey(schema));
      if (schObj) {
        for (const tbl of schObj.tables) {
          if (tbl.name !== table) {
            set.add(tblKey(schema, tbl.name));
          } else {
            for (const c of tbl.columns) {
              if (c.name !== col) set.add(colKey(schema, table, c.name));
            }
          }
        }
      }
    } else if (set.has(tblKey(schema, table))) {
      set.delete(tblKey(schema, table));
      for (const c of allCols) {
        if (c !== col) set.add(colKey(schema, table, c));
      }
    } else {
      set.delete(colKey(schema, table, col));
    }
  } else {
    set.add(colKey(schema, table, col));
    // Normalize: all cols granted → upgrade to table grant
    if (allCols.every((c) => set.has(colKey(schema, table, c)))) {
      allCols.forEach((c) => set.delete(colKey(schema, table, c)));
      set.add(tblKey(schema, table));
      // Normalize: all tables granted → upgrade to schema grant
      if (
        schObj &&
        schObj.tables.every((t) => set.has(tblKey(schema, t.name)))
      ) {
        schObj.tables.forEach((t) => set.delete(tblKey(schema, t.name)));
        set.add(schKey(schema));
      }
    }
  }
  return set;
}

function toggleTableGrant(
  gs: Set<string>,
  schema: string,
  table: string,
  allSchemas: SchemaSchemaObj[],
): Set<string> {
  const set = new Set(gs);
  const schObj = allSchemas.find((s) => s.name === schema);
  const tblObj = schObj?.tables.find((t) => t.name === table);
  if (!tblObj) return set;
  const allCols = tblObj.columns.map((c) => c.name);
  const state = tableGrantState(gs, schema, table, allCols);
  const allGranted = state === "all";

  if (allGranted) {
    if (set.has(schKey(schema))) {
      set.delete(schKey(schema));
      if (schObj) {
        for (const tbl of schObj.tables) {
          if (tbl.name !== table) set.add(tblKey(schema, tbl.name));
        }
      }
    } else {
      set.delete(tblKey(schema, table));
      allCols.forEach((c) => set.delete(colKey(schema, table, c)));
    }
  } else {
    set.add(tblKey(schema, table));
    allCols.forEach((c) => set.delete(colKey(schema, table, c)));
    // Normalize: all tables → schema grant
    if (
      schObj &&
      schObj.tables.every((t) => set.has(tblKey(schema, t.name)))
    ) {
      schObj.tables.forEach((t) => set.delete(tblKey(schema, t.name)));
      set.add(schKey(schema));
    }
  }
  return set;
}

function toggleSchemaGrant(
  gs: Set<string>,
  schema: string,
): Set<string> {
  const set = new Set(gs);
  if (set.has(schKey(schema))) {
    set.delete(schKey(schema));
  } else {
    for (const key of [...set]) {
      if (
        key.startsWith(`tbl:${schema}/`) ||
        key.startsWith(`col:${schema}/`)
      ) {
        set.delete(key);
      }
    }
    set.add(schKey(schema));
  }
  return set;
}

function grantAllForSchema(
  gs: Set<string>,
  schema: string,
): Set<string> {
  const set = new Set(gs);
  for (const key of [...set]) {
    if (
      key.startsWith(`tbl:${schema}/`) ||
      key.startsWith(`col:${schema}/`)
    ) {
      set.delete(key);
    }
  }
  set.add(schKey(schema));
  return set;
}

function revokeAllForSchema(
  gs: Set<string>,
  schema: string,
): Set<string> {
  const set = new Set(gs);
  set.delete(schKey(schema));
  for (const key of [...set]) {
    if (
      key.startsWith(`tbl:${schema}/`) ||
      key.startsWith(`col:${schema}/`)
    ) {
      set.delete(key);
    }
  }
  return set;
}

function grantAllForTable(
  gs: Set<string>,
  schema: string,
  table: string,
  allSchemas: SchemaSchemaObj[],
): Set<string> {
  const set = new Set(gs);
  // Remove column-level grants for this table
  for (const key of [...set]) {
    if (key.startsWith(`col:${schema}/${table}/`)) set.delete(key);
  }
  set.add(tblKey(schema, table));
  // Normalize: all tables → schema
  const schObj = allSchemas.find((s) => s.name === schema);
  if (schObj && schObj.tables.every((t) => set.has(tblKey(schema, t.name)))) {
    schObj.tables.forEach((t) => set.delete(tblKey(schema, t.name)));
    set.add(schKey(schema));
  }
  return set;
}

function revokeAllForTable(
  gs: Set<string>,
  schema: string,
  table: string,
  allSchemas: SchemaSchemaObj[],
): Set<string> {
  const set = new Set(gs);
  if (set.has(schKey(schema))) {
    set.delete(schKey(schema));
    const schObj = allSchemas.find((s) => s.name === schema);
    if (schObj) {
      for (const tbl of schObj.tables) {
        if (tbl.name !== table) set.add(tblKey(schema, tbl.name));
      }
    }
  } else {
    set.delete(tblKey(schema, table));
    for (const key of [...set]) {
      if (key.startsWith(`col:${schema}/${table}/`)) set.delete(key);
    }
  }
  return set;
}

// ─── Tree flattening ──────────────────────────────────────────────────────────

interface FlatNode {
  id: string;
  kind: "schema" | "table" | "column";
  level: number;
  label: string;
  schema: string;
  table?: string;
  column?: string;
  dataType?: string;
  expandable: boolean;
  expanded: boolean;
  checkState: GrantState;
  parentId?: string;
}

function flattenTree(
  schemas: SchemaSchemaObj[],
  grantSet: Set<string>,
  expanded: Set<string>,
  search: string,
): FlatNode[] {
  const q = search.trim().toLowerCase();
  const nodes: FlatNode[] = [];

  for (const schema of schemas) {
    const schemaId = `schema:${schema.name}`;

    // Filter: include schema if its name/any table/any column matches
    const matchesTables = schema.tables.filter((t) => {
      if (!q) return true;
      return (
        schema.name.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
      );
    });

    if (q && matchesTables.length === 0 && !schema.name.toLowerCase().includes(q)) continue;

    const tablesForState = schema.tables.map((t) => ({
      name: t.name,
      cols: t.columns.map((c) => c.name),
    }));

    nodes.push({
      id: schemaId,
      kind: "schema",
      level: 1,
      label: schema.name,
      schema: schema.name,
      expandable: schema.tables.length > 0,
      expanded: expanded.has(schemaId),
      checkState: schemaGrantState(grantSet, schema.name, tablesForState),
    });

    if (!expanded.has(schemaId)) continue;

    const visibleTables = q ? matchesTables : schema.tables;
    for (const table of visibleTables) {
      const tableId = `table:${schema.name}/${table.name}`;
      const allCols = table.columns.map((c) => c.name);

      const filteredCols = q
        ? table.columns.filter(
            (c) =>
              schema.name.toLowerCase().includes(q) ||
              table.name.toLowerCase().includes(q) ||
              c.name.toLowerCase().includes(q),
          )
        : table.columns;

      nodes.push({
        id: tableId,
        kind: "table",
        level: 2,
        label: table.name,
        schema: schema.name,
        table: table.name,
        expandable: table.columns.length > 0,
        expanded: expanded.has(tableId),
        checkState: tableGrantState(grantSet, schema.name, table.name, allCols),
        parentId: schemaId,
      });

      if (!expanded.has(tableId)) continue;

      for (const col of filteredCols) {
        nodes.push({
          id: `col:${schema.name}/${table.name}/${col.name}`,
          kind: "column",
          level: 3,
          label: col.name,
          schema: schema.name,
          table: table.name,
          column: col.name,
          dataType: col.type,
          expandable: false,
          expanded: false,
          checkState: isColGranted(grantSet, schema.name, table.name, col.name)
            ? "all"
            : "none",
          parentId: tableId,
        });
      }
    }
  }

  return nodes;
}

// ─── Tri-state checkbox ───────────────────────────────────────────────────────

interface TriStateCheckboxProps {
  state: GrantState;
  onChange: () => void;
  label: string;
  id?: string;
}

function TriStateCheckbox({ state, onChange, label, id }: TriStateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === "some";
    }
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      id={id}
      aria-label={label}
      checked={state === "all"}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-neutral-300 text-primary-700
        focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
        checked:bg-semantic-success checked:border-semantic-success"
    />
  );
}

// ─── Node icon ────────────────────────────────────────────────────────────────

function NodeIcon({ kind }: { kind: "schema" | "table" | "column" }) {
  if (kind === "schema") {
    // Folder icon
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 flex-shrink-0 text-neutral-400"
        fill="none"
        viewBox="0 0 16 16"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M1.5 4.5A1.5 1.5 0 013 3h3.379a1.5 1.5 0 011.06.44l.621.621A1.5 1.5 0 009.121 4.5H13A1.5 1.5 0 0114.5 6v5A1.5 1.5 0 0113 12.5H3A1.5 1.5 0 011.5 11V4.5z"
        />
      </svg>
    );
  }
  if (kind === "table") {
    // Table icon
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 flex-shrink-0 text-neutral-400"
        fill="none"
        viewBox="0 0 16 16"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
        <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" />
        <line x1="5.5" y1="5.5" x2="5.5" y2="13.5" />
      </svg>
    );
  }
  // Column icon (vertical bars)
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 flex-shrink-0 text-neutral-300"
      fill="none"
      viewBox="0 0 16 16"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <line x1="4" y1="3" x2="4" y2="13" />
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="12" y1="3" x2="12" y2="13" />
    </svg>
  );
}

// ─── Virtual tree ─────────────────────────────────────────────────────────────

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

interface VirtualTreeProps {
  nodes: FlatNode[];
  selectedId: string | null;
  focusedIdx: number;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleGrant: (node: FlatNode) => void;
  onFocusChange: (idx: number) => void;
  nodeRefs: React.MutableRefObject<Map<number, HTMLElement>>;
}

function VirtualTree({
  nodes,
  selectedId,
  focusedIdx,
  onSelect,
  onToggleExpand,
  onToggleGrant,
  onFocusChange,
  nodeRefs,
}: VirtualTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setContainerHeight(h);
    });
    ro.observe(el);
    setContainerHeight(el.clientHeight || 600);
    return () => ro.disconnect();
  }, []);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIdx < 0 || focusedIdx >= nodes.length) return;
    const el = nodeRefs.current.get(focusedIdx);
    if (el) {
      el.focus({ preventScroll: true });
      const itemTop = focusedIdx * ROW_HEIGHT;
      const itemBottom = itemTop + ROW_HEIGHT;
      const container = containerRef.current;
      if (!container) return;
      if (itemTop < container.scrollTop) {
        container.scrollTop = itemTop;
      } else if (itemBottom > container.scrollTop + containerHeight) {
        container.scrollTop = itemBottom - containerHeight;
      }
    }
  }, [focusedIdx, nodes, containerHeight, nodeRefs]);

  const totalHeight = nodes.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    nodes.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    const node = nodes[focusedIdx];
    if (!node) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        onFocusChange(Math.min(nodes.length - 1, focusedIdx + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        onFocusChange(Math.max(0, focusedIdx - 1));
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node.expandable && !node.expanded) {
          onToggleExpand(node.id);
        } else if (node.expandable && node.expanded && focusedIdx + 1 < nodes.length) {
          onFocusChange(focusedIdx + 1);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node.expandable && node.expanded) {
          onToggleExpand(node.id);
        } else if (node.parentId) {
          const parentIdx = nodes.findIndex((n) => n.id === node.parentId);
          if (parentIdx >= 0) onFocusChange(parentIdx);
        }
        break;
      case " ":
        e.preventDefault();
        onToggleGrant(node);
        break;
      case "Enter":
        e.preventDefault();
        if (node.expandable) onToggleExpand(node.id);
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Schema tree"
      tabIndex={nodes.length === 0 ? 0 : -1}
      className="flex-1 overflow-y-auto outline-none"
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      onKeyDown={handleKeyDown}
    >
      {nodes.length === 0 ? (
        <p className="px-4 py-6 text-body-sm text-neutral-400">No schemas found.</p>
      ) : (
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${startIdx * ROW_HEIGHT}px)` }}>
            {nodes.slice(startIdx, endIdx).map((node, relIdx) => {
              const absIdx = startIdx + relIdx;
              const isFocused = absIdx === focusedIdx;
              const isSelected = node.id === selectedId;

              return (
                <TreeRow
                  key={node.id}
                  node={node}
                  isFocused={isFocused}
                  isSelected={isSelected}
                  rowHeight={ROW_HEIGHT}
                  onSelect={() => onSelect(node.id)}
                  onToggleExpand={() => node.expandable && onToggleExpand(node.id)}
                  onToggleGrant={() => onToggleGrant(node)}
                  setRef={(el) => {
                    if (el) nodeRefs.current.set(absIdx, el);
                    else nodeRefs.current.delete(absIdx);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tree row ─────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: FlatNode;
  isFocused: boolean;
  isSelected: boolean;
  rowHeight: number;
  onSelect: () => void;
  onToggleExpand: () => void;
  onToggleGrant: () => void;
  setRef: (el: HTMLElement | null) => void;
}

function TreeRow({
  node,
  isFocused,
  isSelected,
  rowHeight,
  onSelect,
  onToggleExpand,
  onToggleGrant,
  setRef,
}: TreeRowProps) {
  const indent = (node.level - 1) * 20;

  return (
    <div
      ref={setRef}
      role="treeitem"
      aria-level={node.level}
      aria-expanded={node.expandable ? node.expanded : undefined}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      style={{ height: rowHeight, paddingLeft: indent + 8 }}
      className={
        "flex cursor-pointer select-none items-center gap-2 pr-2 text-body-sm outline-none " +
        (isSelected
          ? "bg-primary-50 text-primary-900"
          : "text-neutral-800 hover:bg-neutral-50") +
        " focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
      }
      onClick={() => {
        onSelect();
      }}
    >
      {/* Expand/collapse toggle */}
      {node.expandable ? (
        <button
          type="button"
          aria-label={node.expanded ? "Collapse" : "Expand"}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-neutral-200"
        >
          <svg
            aria-hidden="true"
            className={
              "h-3 w-3 text-neutral-500 transition-transform " +
              (node.expanded ? "rotate-90" : "")
            }
            fill="none"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 2l4 4-4 4" />
          </svg>
        </button>
      ) : (
        <span className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      )}

      <TriStateCheckbox
        state={node.checkState}
        onChange={onToggleGrant}
        label={`${node.label} — ${node.checkState === "all" ? "granted" : node.checkState === "some" ? "partially granted" : "not granted"}`}
      />

      <NodeIcon kind={node.kind} />

      <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>

      {node.dataType && (
        <span className="flex-shrink-0 text-xs text-neutral-400">{node.dataType}</span>
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  selectedId: string | null;
  grantSet: Set<string>;
  schemaTree: SchemaTree | null;
  allSchemas: SchemaSchemaObj[];
  onToggleGrant: (node: FlatNode) => void;
  onGrantAll: () => void;
  onRevokeAll: () => void;
}

function DetailPanel({
  selectedId,
  grantSet,
  allSchemas,
  onToggleGrant,
  onGrantAll,
  onRevokeAll,
}: DetailPanelProps) {
  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-body text-neutral-400">
        Select a schema, table, or column to see details.
      </div>
    );
  }

  // Parse selectedId
  if (selectedId.startsWith("schema:")) {
    const schemaName = selectedId.slice(7);
    const schObj = allSchemas.find((s) => s.name === schemaName);
    const totalTables = schObj?.tables.length ?? 0;
    const grantedTables = schObj?.tables.filter((t) => {
      const allCols = t.columns.map((c) => c.name);
      return tableGrantState(grantSet, schemaName, t.name, allCols) === "all";
    }).length ?? 0;

    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-body-sm text-neutral-500">Schema</p>
            <h2 className="text-heading-2 text-neutral-900">{schemaName}</h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onGrantAll}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-body-sm font-medium text-neutral-700
                hover:bg-neutral-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Grant all
            </button>
            <button
              type="button"
              onClick={onRevokeAll}
              className="rounded-md border border-semantic-error/40 px-3 py-1.5 text-body-sm font-medium text-semantic-error
                hover:bg-semantic-error/10
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error"
            >
              Revoke all
            </button>
          </div>
        </div>

        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-body text-neutral-700">
            <span className="font-semibold text-semantic-success">{grantedTables}</span>
            {" / "}
            <span className="font-semibold">{totalTables}</span>
            {" tables granted"}
          </p>
        </div>
      </div>
    );
  }

  if (selectedId.startsWith("table:")) {
    const rest = selectedId.slice(6);
    const slashIdx = rest.indexOf("/");
    const schemaName = rest.slice(0, slashIdx);
    const tableName = rest.slice(slashIdx + 1);
    const schObj = allSchemas.find((s) => s.name === schemaName);
    const tblObj = schObj?.tables.find((t) => t.name === tableName);

    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-body-sm text-neutral-500">
              Table &nbsp;·&nbsp;{" "}
              <span className="font-mono">{schemaName}</span>
            </p>
            <h2 className="text-heading-2 text-neutral-900">{tableName}</h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onGrantAll}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-body-sm font-medium text-neutral-700
                hover:bg-neutral-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Grant all
            </button>
            <button
              type="button"
              onClick={onRevokeAll}
              className="rounded-md border border-semantic-error/40 px-3 py-1.5 text-body-sm font-medium text-semantic-error
                hover:bg-semantic-error/10
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error"
            >
              Revoke all
            </button>
          </div>
        </div>

        {tblObj && tblObj.columns.length > 0 ? (
          <div className="overflow-y-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th scope="col" className="py-2 pr-4 text-body-sm font-semibold text-neutral-700">
                    Column
                  </th>
                  <th scope="col" className="py-2 pr-4 text-body-sm font-semibold text-neutral-700">
                    Type
                  </th>
                  <th scope="col" className="py-2 text-right text-body-sm font-semibold text-neutral-700">
                    Read access
                  </th>
                </tr>
              </thead>
              <tbody>
                {tblObj.columns.map((col) => {
                  const granted = isColGranted(grantSet, schemaName, tableName, col.name);
                  const fakeNode: FlatNode = {
                    id: `col:${schemaName}/${tableName}/${col.name}`,
                    kind: "column",
                    level: 3,
                    label: col.name,
                    schema: schemaName,
                    table: tableName,
                    column: col.name,
                    dataType: col.type,
                    expandable: false,
                    expanded: false,
                    checkState: granted ? "all" : "none",
                  };
                  return (
                    <tr key={col.name} className="border-b border-neutral-100 hover:bg-neutral-50">
                      <td className="py-2 pr-4 text-body-sm font-medium text-neutral-900">
                        {col.name}
                      </td>
                      <td className="py-2 pr-4 text-body-sm text-neutral-400 font-mono">
                        {col.type}
                      </td>
                      <td className="py-2 text-right">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <span className="sr-only">{granted ? "Revoke" : "Grant"} read access for {col.name}</span>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-checked={granted}
                            checked={granted}
                            onChange={() => onToggleGrant(fakeNode)}
                            className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-primary-700
                              focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-body-sm text-neutral-400">No columns found for this table.</p>
        )}
      </div>
    );
  }

  if (selectedId.startsWith("col:")) {
    const parts = selectedId.slice(4).split("/");
    const [schemaName, tableName, colName] = parts;
    const schObj = allSchemas.find((s) => s.name === schemaName);
    const tblObj = schObj?.tables.find((t) => t.name === tableName);
    const colObj = tblObj?.columns.find((c) => c.name === colName);
    const granted = isColGranted(grantSet, schemaName, tableName, colName);
    const fakeNode: FlatNode = {
      id: selectedId,
      kind: "column",
      level: 3,
      label: colName,
      schema: schemaName,
      table: tableName,
      column: colName,
      ...(colObj?.type !== undefined ? { dataType: colObj.type } : {}),
      expandable: false,
      expanded: false,
      checkState: granted ? "all" : "none",
    };

    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div>
          <p className="text-body-sm text-neutral-500">
            Column &nbsp;·&nbsp;{" "}
            <span className="font-mono">{schemaName}.{tableName}</span>
          </p>
          <h2 className="text-heading-2 text-neutral-900">{colName}</h2>
          {colObj?.type && (
            <p className="mt-1 text-body-sm text-neutral-400 font-mono">{colObj.type}</p>
          )}
        </div>

        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-body font-semibold text-neutral-900">Read access</span>
              <span className="text-body-sm text-neutral-500">
                Allow users in this role to read this column.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={granted}
              checked={granted}
              onChange={() => onToggleGrant(fakeNode)}
              className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-primary-700
                focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            />
          </label>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Cancel confirm dialog ────────────────────────────────────────────────────

interface CancelConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function CancelConfirmDialog({ open, onConfirm, onCancel }: CancelConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby="cancel-confirm-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <Dialog.Title className="mb-1 text-heading-2 text-neutral-900">
            Discard changes?
          </Dialog.Title>
          <Dialog.Description id="cancel-confirm-description" className="mb-6 text-body text-neutral-500">
            You have unsaved permission changes. Leaving now will discard them.
          </Dialog.Description>
          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-neutral-300 px-4 py-2 text-body font-medium text-neutral-700
                  hover:bg-neutral-100
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                Keep editing
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-semantic-error px-4 py-2 text-body font-semibold text-white
                hover:bg-red-700
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-2"
            >
              Discard changes
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred.";
}

export function PermissionEditorPage() {
  const { roleId } = useParams<{ roleId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Data fetching ────────────────────────────────────────────────────────────
  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    retry: false,
  });

  const dsQuery = useQuery({
    queryKey: ["dataSources"],
    queryFn: listDataSources,
    retry: false,
  });

  const [selectedDsId, setSelectedDsId] = useState<string | null>(null);

  // Default to first connected data source when list loads
  useEffect(() => {
    if (!selectedDsId && dsQuery.data && dsQuery.data.length > 0) {
      const first =
        dsQuery.data.find((ds) => ds.status === "connected") ?? dsQuery.data[0];
      setSelectedDsId(first.id);
    }
  }, [dsQuery.data, selectedDsId]);

  const schemaQuery = useQuery({
    queryKey: ["schemaTree", selectedDsId],
    queryFn: () => getSchemaTree(selectedDsId!),
    enabled: !!selectedDsId,
    retry: false,
  });

  const grantsQuery = useQuery({
    queryKey: ["roleGrants", roleId],
    queryFn: () => listRoleGrants(roleId!),
    enabled: !!roleId,
    retry: false,
  });

  // ── Grant set state ──────────────────────────────────────────────────────────
  const [grantSet, setGrantSet] = useState<Set<string>>(new Set());
  const [initialGrantSet, setInitialGrantSet] = useState<Set<string>>(new Set());

  // Initialise grant set when grants + DS are both loaded
  useEffect(() => {
    if (grantsQuery.data && selectedDsId) {
      const s = grantsToSet(grantsQuery.data, selectedDsId);
      setGrantSet(s);
      setInitialGrantSet(new Set(s));
    }
  }, [grantsQuery.data, selectedDsId]);

  // Re-initialise when DS changes (load the relevant slice from the grant set)
  const prevDsRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedDsId && prevDsRef.current !== null && prevDsRef.current !== selectedDsId) {
      if (grantsQuery.data) {
        const s = grantsToSet(grantsQuery.data, selectedDsId);
        setGrantSet(s);
        setInitialGrantSet(new Set(s));
      }
    }
    prevDsRef.current = selectedDsId;
  }, [selectedDsId, grantsQuery.data]);

  const isDirty = useMemo(() => {
    if (grantSet.size !== initialGrantSet.size) return true;
    for (const k of grantSet) {
      if (!initialGrantSet.has(k)) return true;
    }
    return false;
  }, [grantSet, initialGrantSet]);

  // ── Tree state ───────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const nodeRefs = useRef<Map<number, HTMLElement>>(new Map());

  const allSchemas = schemaQuery.data?.schemas ?? [];

  const flatNodes = useMemo(
    () => flattenTree(allSchemas, grantSet, expanded, search),
    [allSchemas, grantSet, expanded, search],
  );

  // ── Save / cancel ────────────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    variant: "success" | "error";
  }>({ open: false, title: "", variant: "success" });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!roleId || !selectedDsId) throw new Error("Missing roleId or dataSourceId.");
      const grants = setToGrants(grantSet, roleId, selectedDsId);
      // Merge with grants from OTHER data sources that are already stored
      const otherGrants = grantsQuery.data?.filter(
        (g) => g.dataSourceId !== selectedDsId,
      ) ?? [];
      return putRoleGrants(roleId, [...otherGrants, ...grants]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roleGrants", roleId] });
      setToast({ open: true, title: "Permissions saved.", variant: "success" });
      setSaveError(null);
      setTimeout(() => navigate("/admin/roles"), 1200);
    },
    onError: (err) => {
      setSaveError(apiErrorMessage(err));
    },
  });

  function handleCancel() {
    if (isDirty) {
      setCancelConfirmOpen(true);
    } else {
      navigate("/admin/roles");
    }
  }

  function handleCancelConfirm() {
    setCancelConfirmOpen(false);
    navigate("/admin/roles");
  }

  // ── Tree interaction ─────────────────────────────────────────────────────────
  function handleToggleExpand(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function handleToggleGrant(node: FlatNode) {
    setGrantSet((prev) => {
      if (node.kind === "schema") return toggleSchemaGrant(prev, node.schema);
      if (node.kind === "table") return toggleTableGrant(prev, node.schema, node.table!, allSchemas);
      return toggleColGrant(prev, node.schema, node.table!, node.column!, allSchemas);
    });
  }

  function handleGrantAll() {
    if (!selectedId) return;
    if (selectedId.startsWith("schema:")) {
      const schemaName = selectedId.slice(7);
      setGrantSet((prev) => grantAllForSchema(prev, schemaName));
    } else if (selectedId.startsWith("table:")) {
      const rest = selectedId.slice(6);
      const idx = rest.indexOf("/");
      const schemaName = rest.slice(0, idx);
      const tableName = rest.slice(idx + 1);
      setGrantSet((prev) => grantAllForTable(prev, schemaName, tableName, allSchemas));
    }
  }

  function handleRevokeAll() {
    if (!selectedId) return;
    if (selectedId.startsWith("schema:")) {
      const schemaName = selectedId.slice(7);
      setGrantSet((prev) => revokeAllForSchema(prev, schemaName));
    } else if (selectedId.startsWith("table:")) {
      const rest = selectedId.slice(6);
      const idx = rest.indexOf("/");
      const schemaName = rest.slice(0, idx);
      const tableName = rest.slice(idx + 1);
      setGrantSet((prev) => revokeAllForTable(prev, schemaName, tableName, allSchemas));
    }
  }

  // ── Derived role ─────────────────────────────────────────────────────────────
  const role = rolesQuery.data?.find((r: Role) => r.id === roleId);
  const roleName = role?.name ?? roleId ?? "Role";

  // ── Loading / error states ───────────────────────────────────────────────────
  const isLoadingCore = rolesQuery.isPending || dsQuery.isPending;
  const isLoadingSchema = schemaQuery.isPending && !!selectedDsId;
  const isLoadingGrants = grantsQuery.isPending && !!roleId;
  const hasCoreError = rolesQuery.isError || dsQuery.isError;

  return (
    <Toast.Provider swipeDirection="right">
      {/* Focused editing mode — no sidebar shown. Breadcrumb provides navigation. */}
      <div className="flex h-screen flex-col bg-neutral-50">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
          <div className="flex flex-col gap-0.5">
            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb">
              <ol className="flex items-center gap-1 text-body-sm text-neutral-500">
                <li>
                  <Link
                    to="/admin"
                    className="hover:text-primary-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500 rounded"
                  >
                    Admin
                  </Link>
                </li>
                <li aria-hidden="true">›</li>
                <li>
                  <Link
                    to="/admin/roles"
                    className="hover:text-primary-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500 rounded"
                  >
                    Roles
                  </Link>
                </li>
                <li aria-hidden="true">›</li>
                <li className="text-neutral-700">{roleName}</li>
                <li aria-hidden="true">›</li>
                <li aria-current="page" className="font-medium text-neutral-900">
                  Permissions
                </li>
              </ol>
            </nav>

            {/* Role name + unsaved badge */}
            <div className="flex items-center gap-2">
              <h1 className="text-heading-2 text-neutral-900">{roleName}</h1>
              {isDirty && (
                <span
                  aria-live="polite"
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                >
                  Unsaved changes
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-neutral-300 px-4 py-2 text-body font-medium text-neutral-700
                hover:bg-neutral-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !selectedDsId}
              aria-disabled={saveMutation.isPending}
              className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                transition-colors hover:bg-primary-800
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </header>

        {/* Save error */}
        {saveError && (
          <div className="flex-shrink-0 border-b border-semantic-error/30 bg-semantic-error/10 px-6 py-2">
            <p role="alert" className="text-body-sm text-semantic-error">
              {saveError}
            </p>
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        {isLoadingCore ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-body text-neutral-500" role="status" aria-live="polite">
              Loading…
            </p>
          </div>
        ) : hasCoreError ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p role="alert" className="text-body text-semantic-error">
              Failed to load data. Please refresh the page.
            </p>
          </div>
        ) : dsQuery.data?.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-body text-neutral-500">
              No data sources configured. Add a data source to manage permissions.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* ── Left panel: schema browser (40%) ─────────────────────────── */}
            <div className="flex w-2/5 flex-shrink-0 flex-col border-r border-neutral-200 bg-white">
              <div className="flex-shrink-0 border-b border-neutral-200 p-3 flex flex-col gap-2">
                {/* Data source selector */}
                {dsQuery.data && dsQuery.data.length > 1 && (
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="ds-select"
                      className="flex-shrink-0 text-body-sm font-medium text-neutral-600"
                    >
                      Data source:
                    </label>
                    <select
                      id="ds-select"
                      value={selectedDsId ?? ""}
                      onChange={(e) => setSelectedDsId(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-body-sm
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {dsQuery.data.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Search */}
                <div>
                  <label htmlFor="schema-search" className="sr-only">
                    Search tables or columns
                  </label>
                  <input
                    id="schema-search"
                    type="search"
                    placeholder="Search tables or columns…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-body-sm
                      placeholder-neutral-400
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                </div>
              </div>

              {/* Tree */}
              {isLoadingSchema || isLoadingGrants ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-body-sm text-neutral-400" role="status" aria-live="polite">
                    Loading schema…
                  </p>
                </div>
              ) : schemaQuery.isError ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <p role="alert" className="text-body-sm text-semantic-error">
                    Failed to load schema.
                  </p>
                </div>
              ) : (
                <VirtualTree
                  nodes={flatNodes}
                  selectedId={selectedId}
                  focusedIdx={focusedIdx}
                  onSelect={(id) => {
                    setSelectedId(id);
                    const idx = flatNodes.findIndex((n) => n.id === id);
                    if (idx >= 0) setFocusedIdx(idx);
                  }}
                  onToggleExpand={handleToggleExpand}
                  onToggleGrant={handleToggleGrant}
                  onFocusChange={setFocusedIdx}
                  nodeRefs={nodeRefs}
                />
              )}
            </div>

            {/* ── Right panel: detail view (60%) ───────────────────────────── */}
            <div className="flex min-h-0 flex-1 flex-col bg-white">
              <DetailPanel
                selectedId={selectedId}
                grantSet={grantSet}
                schemaTree={schemaQuery.data ?? null}
                allSchemas={allSchemas}
                onToggleGrant={handleToggleGrant}
                onGrantAll={handleGrantAll}
                onRevokeAll={handleRevokeAll}
              />
            </div>
          </div>
        )}
      </div>

      {/* Cancel confirm dialog */}
      <CancelConfirmDialog
        open={cancelConfirmOpen}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      {/* Toast */}
      <Toast.Root
        open={toast.open}
        onOpenChange={(open) => setToast((t) => ({ ...t, open }))}
        className={
          "pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg " +
          (toast.variant === "success"
            ? "border-semantic-success/30 bg-white text-semantic-success"
            : "border-semantic-error/30 bg-white text-semantic-error")
        }
        duration={3000}
      >
        <Toast.Title className="text-body font-semibold">{toast.title}</Toast.Title>
        <Toast.Close asChild>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="ml-auto rounded p-0.5 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite" />
    </Toast.Provider>
  );
}
