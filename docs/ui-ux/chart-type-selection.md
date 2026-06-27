# Auto Chart-Type Selection UX

### Selection Logic (design-level rules — fulfills GAP-19 with stated assumptions)

The backend determines chart type based on result shape. The UI communicates the selection transparently and provides the table toggle as an escape hatch. Manual chart-type switching is out of scope for v1.

Assumed selection mapping (to be confirmed and implemented by Architect/coder):

| Data shape | Auto-selected chart type | Rationale |
|------------|--------------------------|-----------|
| 1 dimension (categorical / ordinal) + 1 numeric measure | Bar chart | Comparison of discrete categories |
| 1 time dimension + 1 or more numeric measures | Line chart | Trends over time |
| 1 dimension (3–8 distinct values) + 1 numeric measure summing to a whole | Pie / Donut chart | Part-of-whole proportions; cardinality limit enforced |
| 1 dimension (>8 distinct values) + 1 numeric measure | Bar chart | Pie not appropriate at high cardinality |
| 2+ dimensions or mixed types where no clear chart maps | Data Table | Raw exploration; always correct fallback |
| Result has 0 rows | Data Table (empty) | Empty state; chart would be meaningless |
| Result has >2000 rows (threshold — GAP-8 pending) | Data Table with pagination | Chart rendering would be illegible/slow |

### How the UX communicates chart selection

1. The chart type badge (top-left of ChartCard) shows the auto-selected type as a read-only label. Users are informed without being given a control that is out of scope.
2. The chart renders immediately; there is no "selecting chart..." intermediate state.
3. If the selection logic falls back to Data Table, the badge reads "Table" and no toggle is shown (chart and table are the same view). The toggle only appears when a chart was actually rendered.
4. The chart renders with the chart-cat palette; series order follows the result set column order.
5. No override control is exposed in v1. Future work (manual chart manipulation) can add a "Change chart type" button in the same header row without breaking the layout.

### Chart ↔ Table Toggle Affordance

- Toggle button is always visible on ChartCards where a chart (not table) was auto-selected.
- When in table view, toggle shows "Chart view" to return.
- The toggle is a labeled button with an icon — never an icon-only control — to ensure discoverability and accessibility.
- Current view mode is also reflected in the `aria-pressed` state of the toggle button.
