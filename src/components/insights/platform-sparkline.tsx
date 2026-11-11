"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
import { CHART } from "@/lib/insights/chart-theme";

/** Tiny trend line for a single metric inside a platform section. */
export function PlatformSparkline({
  data,
  positive = true,
}: {
  data: { value: number }[];
  positive?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={positive ? CHART.revenue : CHART.spend}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
