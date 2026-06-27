# Accessibility

### Chart ↔ Table Toggle as Accessible Fallback (NFR-A11Y-1)

The requirements explicitly identify the chart/table toggle (FR-VIZ-3) as the accessibility mechanism for chart content. Design implementation:

1. Every chart in the chat workspace is accompanied by a visible, labeled toggle button ("Table view"). Screen reader users can reach this button in the natural tab order.
2. When in table view, the data is fully accessible as a standard HTML table with proper `<thead>`, `<th scope="col">`, `<caption>`, and ARIA roles.
3. Chart SVG elements include `role="img"` and `aria-label` describing the chart title and data summary (e.g., "Bar chart: monthly revenue by region, January through June. 6 data points. Use the Table view button to see the full data.").
4. Pie/donut chart slices include `aria-label` per slice: "[Label]: [value] ([percentage]%)".
5. Tooltips on hover are also triggered on keyboard focus of individual chart elements (where the charting library supports it).

### General Accessibility Commitments

- All interactive controls: keyboard focusable, visible focus indicator (3px solid `color-primary-500`, 2px offset).
- All form fields: explicit `<label>` associations (not placeholder-only).
- All icon-only buttons: `aria-label` (none used in this design — all buttons have visible labels).
- Modals: focus trapped inside while open; `aria-modal="true"`; Escape closes.
- Drawers: same focus management as modals.
- Toasts: announced via `aria-live="polite"` region.
- Error messages: associated with form fields via `aria-describedby`.
- Admin tree (S5): standard tree ARIA pattern (`role="tree"`, `role="treeitem"`, keyboard: arrow keys expand/collapse, space toggles checkbox).
- Color is never the sole differentiator: status indicators combine color + icon + text label.
