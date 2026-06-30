import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ResultEnvelope } from "@bi/contracts";
import { CHART_COLORS } from "./chart-colors";

interface Props {
  envelope: ResultEnvelope;
}

function fmtValue(v: number | string | null): string {
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v ?? "");
}

export function BarChartView({ envelope }: Props) {
  const { columns, rows } = envelope;
  const dimCol = columns.find((c) => c.role === "dimension" || c.role === "time");
  const measureCols = columns.filter((c) => c.role === "measure");

  const summary = `Bar chart: ${dimCol?.name ?? "data"} by ${measureCols.map((c) => c.name).join(", ")}. ${rows.length} data points. Use the Table view button to see the full data.`;

  return (
    <div
      role="img"
      aria-label={summary}
      className="w-full h-64"
      data-testid="bar-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D1D5DB" />
          {dimCol && <XAxis dataKey={dimCol.name} tick={{ fontSize: 12 }} />}
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number | string, name: string) => [fmtValue(value as number | string | null), name]}
          />
          {measureCols.length > 1 && <Legend />}
          {measureCols.map((col, i) => (
            <Bar
              key={col.name}
              dataKey={col.name}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              tabIndex={0}
              aria-label={`${col.name} series`}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
