import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ResultEnvelope } from "@bi/contracts";
import { CHART_COLORS } from "./chart-colors";

interface Props {
  envelope: ResultEnvelope;
}

interface PieLabelProps {
  name: string;
  value: number;
  percent: number;
}

export function PieChartView({ envelope }: Props) {
  const { columns, rows } = envelope;
  const dimCol = columns.find((c) => c.role === "dimension");
  const measureCol = columns.find((c) => c.role === "measure");

  if (!dimCol || !measureCol) return null;

  const data = rows.map((row) => ({
    name: String(row[dimCol.name] ?? ""),
    value: Number(row[measureCol.name] ?? 0),
  }));

  const total = data.reduce((s, d) => s + d.value, 0);

  const renderCustomLabel = ({ name, value, percent }: PieLabelProps) =>
    `${name}: ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${(percent * 100).toFixed(1)}%)`;

  const summary = `Pie chart: ${measureCol.name} by ${dimCol.name}. ${data.length} slices. Use the Table view button to see the full data.`;

  return (
    <div
      role="img"
      aria-label={summary}
      className="w-full h-64"
      data-testid="pie-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={renderCustomLabel}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.name}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                aria-label={`${entry.name}: ${entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0}%)`}
                tabIndex={0}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) =>
              value.toLocaleString(undefined, { maximumFractionDigits: 2 })
            }
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
