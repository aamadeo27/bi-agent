import {
  LineChart,
  Line,
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

export function LineChartView({ envelope }: Props) {
  const { columns, rows } = envelope;
  const timeCol = columns.find((c) => c.role === "time") ?? columns.find((c) => c.role === "dimension");
  const measureCols = columns.filter((c) => c.role === "measure");

  const summary = `Line chart: ${timeCol?.name ?? "data"} by ${measureCols.map((c) => c.name).join(", ")}. ${rows.length} data points. Use the Table view button to see the full data.`;

  return (
    <div
      role="img"
      aria-label={summary}
      className="w-full h-64"
      data-testid="line-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D1D5DB" />
          {timeCol && <XAxis dataKey={timeCol.name} tick={{ fontSize: 12 }} />}
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number | string, name: string) => [fmtValue(value as number | string | null), name]}
          />
          {measureCols.length > 1 && <Legend />}
          {measureCols.map((col, i) => (
            <Line
              key={col.name}
              type="monotone"
              dataKey={col.name}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              dot={{ tabIndex: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
