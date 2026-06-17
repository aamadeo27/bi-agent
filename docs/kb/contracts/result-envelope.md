## result-envelope

Wraps every successful query result. Drives chart render, toggle, export.
```ts
interface ResultEnvelope {
  messageId: string;
  queryType: "sql" | "rest";
  chartType: "bar" | "line" | "pie" | "table";   // server auto-selected (UI/UX §9)
  columns: Array<{ name: string; type: ColumnType; role: "dimension" | "measure" | "time" }>;
  rows: Array<Record<string, string | number | null>>; // capped at row cap (GAP-8)
  rowCount: number;            // total rows the query produced
  truncated: boolean;          // true if rowCount > returned rows (cap hit)
  notes?: string;              // e.g. "downgraded to table: >2000 rows"
}
type ColumnType = "string" | "number" | "integer" | "boolean" | "date" | "datetime";
```
- Toggle/export consume this client-side cache (no re-query — GAP-13).
- `chartType` selection rules per UI/UX §9; server is authoritative, UI badge mirrors it.
