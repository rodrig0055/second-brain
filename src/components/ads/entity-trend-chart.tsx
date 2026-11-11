"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART, axisProps, dayTick, gridProps } from "@/lib/insights/chart-theme";
import type { AdTotals } from "@/lib/ads/metrics";
import type { AdsLevel, EntityDay } from "@/lib/ads/store";
import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * One entity's metric over the table's window, day by day.
 *
 * Rates are plotted as gaps, not zeros, on days with no denominator: a day
 * with no revenue has no CIR, and drawing it at 0% would read as the best day
 * of the week.
 */

type Metric = {
  key: string;
  label: string;
  value: (t: AdTotals) => number | null;
  format: (v: number, currency: string) => string;
};

const money = (v: number, currency: string) =>
  `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
const pct = (v: number) => `${v.toFixed(v < 10 ? 2 : 0)}%`;
const count = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const when = (v: number, denominator: number) => (denominator > 0 ? v : null);

const METRICS: Metric[] = [
  { key: "spend", label: "Spent", value: (t) => t.spend, format: money },
  { key: "roas", label: "ROAS", value: (t) => when(t.roas, t.spend), format: (v) => `${v.toFixed(2)}x` },
  { key: "cir", label: "CIR", value: (t) => when(t.cir, t.purchaseValue), format: pct },
  { key: "purchases", label: "Purchases", value: (t) => t.purchases, format: count },
  { key: "purchaseValue", label: "Conv. value", value: (t) => t.purchaseValue, format: money },
  { key: "cpp", label: "Cost per purchase", value: (t) => when(t.cpp, t.purchases), format: money },
  { key: "impressions", label: "Impressions", value: (t) => t.impressions, format: count },
  { key: "ctr", label: "CTR (outbound)", value: (t) => when(t.ctr, t.impressions), format: pct },
  { key: "cpc", label: "CPC (outbound)", value: (t) => when(t.cpc, t.outboundClicks), format: money },
  { key: "cpm", label: "CPM", value: (t) => when(t.cpm, t.impressions), format: money },
  { key: "lpvr", label: "LPVr", value: (t) => when(t.lpvr, t.outboundClicks), format: pct },
  { key: "warm", label: "Warm (ATC + IC)", value: (t) => t.warm, format: count },
  { key: "costPerWarm", label: "Cost per warm", value: (t) => when(t.costPerWarm, t.warm), format: money },
  { key: "hookRate", label: "Hook rate", value: (t) => when(t.hookRate, t.impressions), format: pct },
  { key: "holdRate", label: "Hold rate", value: (t) => when(t.holdRate, t.videoViews3s), format: pct },
];

const STROKE = "#7c3aed";

export function EntityTrendChart({
  teamSlug,
  brandId,
  level,
  entityId,
  range,
  currency,
}: {
  teamSlug: string;
  brandId: string;
  level: AdsLevel;
  entityId: string;
  range: { start: string; end: string };
  currency: string;
}) {
  const [metricKey, setMetricKey] = useState("spend");
  const [days, setDays] = useState<EntityDay[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      setDays(null);
      setError(false);
    });
    fetch(
      `/api/ads/entity/daily?${new URLSearchParams({
        team: teamSlug,
        brandId,
        level,
        entityId,
        start: range.start,
        end: range.end,
      })}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { days: EntityDay[] };
        if (live) setDays(body.days);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [teamSlug, brandId, level, entityId, range.start, range.end]);

  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];
  const data = (days ?? []).map((d) => ({ date: d.date, value: metric.value(d.totals) }));
  const plotted = data.filter((d) => d.value !== null).length;

  return (
    <div className="border-t border-zinc-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.7rem] font-medium text-zinc-700">Day by day</p>
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          aria-label="Metric"
          className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="py-8 text-center text-[0.7rem] text-red-600">Could not load the daily numbers.</p>
      ) : !days ? (
        <Skeleton height={176} />
      ) : plotted === 0 ? (
        <p className="py-8 text-center text-[0.7rem] text-zinc-400">
          No {metric.label} to plot in this window.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={176}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={dayTick} {...axisProps} minTickGap={24} />
            <YAxis
              {...axisProps}
              width={56}
              tickFormatter={(v) => compact(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: CHART.grid }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const v = payload[0].value;
                return (
                  <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-elevated">
                    <p className="mb-0.5 font-medium tabular-nums text-zinc-700">{label}</p>
                    <p className="tabular-nums text-zinc-600">
                      {metric.label}{" "}
                      <span className="text-zinc-900">
                        {v == null ? "no data" : metric.format(Number(v), currency)}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke={STROKE}
              fill={STROKE}
              fillOpacity={0.08}
              strokeWidth={1.5}
              dot={data.length <= 14 ? { r: 2, fill: STROKE, strokeWidth: 0 } : false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function compact(v: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
