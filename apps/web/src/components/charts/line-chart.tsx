import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ResultEnvelope } from "@bi/contracts";
import { CHART_PALETTE, LARGE_RESULT_THRESHOLD } from "./chart-palette";
import { formatValue, buildChartAriaLabel } from "./chart-utils";
import { EmptyState } from "./empty-state";
import { LargeResultBanner } from "./large-result-banner";

interface LineChartProps {
  envelope: ResultEnvelope;
}

export function LineChart({ envelope }: LineChartProps) {
  const { columns, rows, rowCount, truncated } = envelope;

  const timeOrDimCol = columns.find((c) => c.role === "time" || c.role === "dimension");
  const measureCols = columns.filter((c) => c.role === "measure");

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const showBanner = truncated || rowCount > LARGE_RESULT_THRESHOLD;
  const ariaLabel = buildChartAriaLabel("line", columns, rows.length);

  return (
    <div className="flex flex-col gap-2">
      {showBanner && <LargeResultBanner rowCount={rowCount} />}
      <div role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={320}>
          <RechartsLineChart
            data={rows as Record<string, string | number>[]}
            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#D1D5DB" />
            {timeOrDimCol && (
              <XAxis dataKey={timeOrDimCol.name} tick={{ fontSize: 12 }} />
            )}
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatValue(v as number)} />
            <Tooltip
              formatter={(value, name) => [
                formatValue(value as number),
                String(name),
              ]}
            />
            <Legend />
            {measureCols.map((col, i) => (
              <Line
                key={col.name}
                type="monotone"
                dataKey={col.name}
                stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
