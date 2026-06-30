import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ResultEnvelope } from "@bi/contracts";
import { CHART_PALETTE, LARGE_RESULT_THRESHOLD } from "./chart-palette";
import { formatValue, buildChartAriaLabel } from "./chart-utils";
import { EmptyState } from "./empty-state";
import { LargeResultBanner } from "./large-result-banner";

interface PieChartProps {
  envelope: ResultEnvelope;
}

interface PieEntry {
  name: string;
  value: number;
}

export function PieChart({ envelope }: PieChartProps) {
  const { columns, rows, rowCount, truncated } = envelope;

  const labelCol = columns.find((c) => c.role === "dimension" || c.role === "time");
  const valueCol = columns.find((c) => c.role === "measure");

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const showBanner = truncated || rowCount > LARGE_RESULT_THRESHOLD;
  const ariaLabel = buildChartAriaLabel("pie", columns, rows.length);

  const data: PieEntry[] = rows.map((row) => ({
    name: labelCol ? formatValue(row[labelCol.name]) : "–",
    value: valueCol ? Number(row[valueCol.name] ?? 0) : 0,
  }));

  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex flex-col gap-2">
      {showBanner && <LargeResultBanner rowCount={rowCount} />}
      <div role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={320}>
          <RechartsPieChart accessibilityLayer>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="30%"
              outerRadius="60%"
              paddingAngle={2}
              label={({ name, value, percent }) =>
                `${name}: ${formatValue(value)} (${((percent ?? 0) * 100).toFixed(1)}%)`
              }
              labelLine={false}
            >
              {data.map((entry, i) => {
                const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
                return (
                  <Cell
                    key={`cell-${i}`}
                    fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                    aria-label={`${entry.name}: ${formatValue(entry.value)} (${pct}%)`}
                  />
                );
              })}
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                formatValue(value as number),
                String(name),
              ]}
            />
            <Legend />
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
