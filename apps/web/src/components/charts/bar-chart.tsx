import {
  BarChart as RechartsBarChart,
  Bar,
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

interface BarChartProps {
  envelope: ResultEnvelope;
}

export function BarChart({ envelope }: BarChartProps) {
  const { columns, rows, rowCount, truncated } = envelope;

  const dimensionCol = columns.find((c) => c.role === "dimension" || c.role === "time");
  const measureCols = columns.filter((c) => c.role === "measure");

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const showBanner = truncated || rowCount > LARGE_RESULT_THRESHOLD;
  const ariaLabel = buildChartAriaLabel("bar", columns, rows.length);

  return (
    <div className="flex flex-col gap-2">
      {showBanner && <LargeResultBanner rowCount={rowCount} />}
      <div role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={320}>
          <RechartsBarChart
            data={rows as Record<string, string | number>[]}
            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#D1D5DB" />
            {dimensionCol && (
              <XAxis dataKey={dimensionCol.name} tick={{ fontSize: 12 }} />
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
              <Bar
                key={col.name}
                dataKey={col.name}
                fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
