/** Categorical palette — 8 series, deuteranopia-safe first four. Design tokens §1. */
export const CHART_PALETTE = [
  "#3B72CC", // chart-cat-1 Primary Blue
  "#E07B39", // chart-cat-2 Orange
  "#0EA5A0", // chart-cat-3 Teal
  "#B447B2", // chart-cat-4 Purple
  "#E8C832", // chart-cat-5 Yellow
  "#D94F4F", // chart-cat-6 Red
  "#5DB76E", // chart-cat-7 Green
  "#7B61A8", // chart-cat-8 Violet
] as const;

/** Row count above which a large-result info banner is shown (GAP-8/GAP-14 exact threshold TBD). */
export const LARGE_RESULT_THRESHOLD = 1000;
