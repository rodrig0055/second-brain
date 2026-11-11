"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

/**
 * A trend shape, not a chart: no axes, no tooltip, no grid. It answers "which
 * way" beside a number that answers "how much".
 */
export function KpiSparkline({
  data,
  positive = true,
  height = 28,
}: {
  data: { value: number }[];
  positive?: boolean;
  height?: number;
}) {
  if (data.length < 2) return null;
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={positive ? "var(--color-emerald-500, #10b981)" : "var(--color-zinc-400, #a1a1aa)"}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
