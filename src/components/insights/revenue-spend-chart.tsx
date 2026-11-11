"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisProps, dayTick, gridProps } from "@/lib/insights/chart-theme";
import { formatCompactMoney, formatMoney } from "@/lib/insights/format";

type Point = { date: string; revenue: number; spend: number };

type TooltipEntry = { dataKey?: string | number; value?: number };

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const rev = payload.find((p) => p.dataKey === "revenue")?.value ?? 0;
  const spend = payload.find((p) => p.dataKey === "spend")?.value ?? 0;
  const roas = spend > 0 ? (rev / spend).toFixed(2) : null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-elevated">
      <p className="mb-1 font-medium tabular-nums text-zinc-700">{label}</p>
      <Row color={CHART.revenue} label="Revenue" value={formatMoney(Number(rev), currency)} />
      <Row color={CHART.spend} label="Spend" value={formatMoney(Number(spend), currency)} />
      {roas && (
        <p className="mt-1 border-t border-zinc-200 pt-1 tabular-nums text-zinc-600">
          ROAS <span className="text-zinc-900">{roas}×</span>
        </p>
      )}
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center gap-2 tabular-nums text-zinc-600">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <span className="text-zinc-900">{value}</span>
    </p>
  );
}

export function RevenueSpendChart({
  data,
  currency,
}: {
  data: Point[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={dayTick} {...axisProps} minTickGap={24} />
        <YAxis
          {...axisProps}
          width={52}
          tickFormatter={(v) => formatCompactMoney(Number(v), currency)}
        />
        <Tooltip
          cursor={{ stroke: CHART.grid }}
          content={<ChartTooltip currency={currency} />}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={CHART.revenue}
          fill={CHART.revenue}
          fillOpacity={0.08}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="spend"
          stroke={CHART.spend}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
