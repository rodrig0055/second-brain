"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisProps, gridProps } from "@/lib/insights/chart-theme";
import type {
  AdRow,
  CreativeDashboardResult,
  EvalMetric,
  IterationResult,
  KillScaleResult,
  WinRateResult,
} from "@/lib/integrations/meta/creative-dashboard-types";

// ---- formatting ----

function money(v: number, cur: string, dp = 0): string {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: dp,
    }).format(v);
  } catch {
    return `${cur} ${v.toFixed(dp)}`;
  }
}
const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const metricLabel: Record<EvalMetric, string> = {
  roas: "ROAS",
  cpa: "CPA",
  ctr: "CTR",
  purchases: "Purchases",
};

function fmtMetric(metric: EvalMetric, v: number | null, cur: string): string {
  if (v === null) return "N/A";
  switch (metric) {
    case "roas":
      return `${v.toFixed(2)}×`;
    case "cpa":
      return money(v, cur, 2);
    case "ctr":
      return `${v.toFixed(2)}%`;
    case "purchases":
      return v.toLocaleString("en-PH", { maximumFractionDigits: 0 });
  }
}

// ---- shared primitives ----

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-700">{children}</h3>;
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium text-zinc-500 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
function Td({
  children,
  right,
  tone,
}: {
  children: React.ReactNode;
  right?: boolean;
  tone?: "good" | "bad" | "muted";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-500"
        : tone === "muted"
          ? "text-zinc-400"
          : "text-zinc-800";
  return (
    <td className={`px-3 py-2 tabular-nums ${right ? "text-right" : ""} ${toneCls}`}>{children}</td>
  );
}
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[26rem] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-card">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-6 text-center text-sm text-zinc-400">
        {text}
      </td>
    </tr>
  );
}
function Thumb({ row }: { row: AdRow }) {
  if (!row.thumbnailUrl) {
    return <div className="h-9 w-9 shrink-0 rounded bg-zinc-100" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={row.thumbnailUrl}
      alt=""
      className="h-9 w-9 shrink-0 rounded object-cover"
    />
  );
}

// ---- 1. Win-rate by category ----

export function WinRateView({ d }: { d: WinRateResult }) {
  const cur = d.currency;
  if (d.totalAds === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-card">
        No classified creatives with spend in this window yet. Run{" "}
        <strong>Analyze creatives</strong> above first.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-zinc-500">
        {d.totalAds} classified ads · win = {metricLabel[d.metric]}{" "}
        {d.metric === "cpa" ? "≤" : "≥"} {d.threshold}
      </p>
      {d.dimensions.map((dim) => {
        const chartData = dim.segments.map((s) => ({
          name: humanize(s.key),
          winRate: Math.round(s.winRate * 100),
          spend: s.spend,
        }));
        return (
          <div key={dim.dimension}>
            <SectionTitle>{dim.label}</SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card">
                <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 34)}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <XAxis type="number" domain={[0, 100]} {...axisProps} unit="%" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      {...axisProps}
                    />
                    <Tooltip
                      formatter={(v) => [`${Number(v)}%`, "Win-rate"]}
                      cursor={{ fill: "rgba(24,24,27,0.04)" }}
                    />
                    <Bar dataKey="winRate" radius={[0, 4, 4, 0]} {...gridProps}>
                      {chartData.map((c, i) => (
                        <Cell
                          key={i}
                          fill={c.winRate >= 50 ? CHART.positive : CHART.spend}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <TableShell>
                <thead className="sticky top-0 bg-zinc-50 text-xs">
                  <tr>
                    <Th>{dim.label}</Th>
                    <Th right>Ads</Th>
                    <Th right>Win-rate</Th>
                    <Th right>Avg {metricLabel[d.metric]}</Th>
                    <Th right>Spend</Th>
                  </tr>
                </thead>
                <tbody>
                  {dim.segments.map((s) => (
                    <tr key={s.key} className="border-t border-zinc-100">
                      <Td>{humanize(s.key)}</Td>
                      <Td right>{s.ads}</Td>
                      <Td right tone={s.winRate >= 0.5 ? "good" : "bad"}>
                        {Math.round(s.winRate * 100)}%
                      </Td>
                      <Td right>{fmtMetric(d.metric, s.avgMetric, cur)}</Td>
                      <Td right>{money(s.spend, cur)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- 2. Kill / Scale ----

function AdMiniTable({
  rows,
  metric,
  cur,
  tone,
  emptyText,
}: {
  rows: AdRow[];
  metric: EvalMetric;
  cur: string;
  tone: "good" | "bad";
  emptyText: string;
}) {
  return (
    <TableShell>
      <thead className="sticky top-0 bg-zinc-50 text-xs">
        <tr>
          <Th>Ad</Th>
          <Th right>Spend</Th>
          <Th right>{metricLabel[metric]}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={3} text={emptyText} />}
        {rows.map((r) => (
          <tr key={r.adId} className="border-t border-zinc-100">
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <Thumb row={r} />
                <div className="min-w-0">
                  <p className="truncate text-zinc-800" title={r.adName}>
                    {r.adName || r.adId}
                  </p>
                  <p className="truncate text-[0.7rem] text-zinc-400">
                    {[r.assetType, r.messagingAngle, r.hookTactic]
                      .filter(Boolean)
                      .map((x) => humanize(String(x)))
                      .join(" · ")}
                  </p>
                </div>
              </div>
            </td>
            <Td right>{money(r.spend, cur)}</Td>
            <Td right tone={tone}>
              {fmtMetric(metric, r.metricValue, cur)}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function KillScaleView({ d }: { d: KillScaleResult }) {
  if (d.stages.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-card">
        No classified creatives with spend in this window yet. Run{" "}
        <strong>Analyze creatives</strong> above first.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-zinc-500">
        Target: {metricLabel[d.metric]} {d.metric === "cpa" ? "≤" : "≥"} {d.threshold} ·
        ranked by spend
      </p>
      {d.stages.map((s) => (
        <div key={s.stage}>
          <SectionTitle>
            {s.stage === "unclassified" ? "Unclassified stage" : s.stage}
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-emerald-700">
                ⬆ Scale ({s.scale.length})
              </p>
              <AdMiniTable
                rows={s.scale}
                metric={d.metric}
                cur={d.currency}
                tone="good"
                emptyText="No winners to scale here."
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-red-500">
                ⬇ Kill ({s.kill.length})
              </p>
              <AdMiniTable
                rows={s.kill}
                metric={d.metric}
                cur={d.currency}
                tone="bad"
                emptyText="Nothing to kill here."
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- 3. Iteration priorities ----

export function IterationView({
  d,
  connectionId,
}: {
  d: IterationResult;
  connectionId: string;
}) {
  const cur = d.currency;
  const [ideas, setIdeas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function getIdeas(adId: string) {
    setLoading(adId);
    setErrors((e) => ({ ...e, [adId]: "" }));
    try {
      const res = await fetch("/api/meta/creatives/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          adId,
          metric: d.metric,
          threshold: d.threshold,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setIdeas((prev) => ({ ...prev, [adId]: json.ideas as string }));
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [adId]: err instanceof Error ? err.message : "Failed to generate ideas",
      }));
    } finally {
      setLoading(null);
    }
  }

  if (d.underperformers.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-card">
        No underperformers with spend in this window — either nothing is
        classified yet (run <strong>Analyze creatives</strong>) or every ad is
        beating the target.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        {d.underperformers.length} underperformers below {metricLabel[d.metric]}{" "}
        {d.metric === "cpa" ? "≤" : "≥"} {d.threshold}, ranked by spend behind
        them.
      </p>
      <div className="space-y-2">
        {d.underperformers.map((r) => (
          <div
            key={r.adId}
            className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card"
          >
            <div className="flex items-start gap-3">
              <Thumb row={r} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-800" title={r.adName}>
                  {r.adName || r.adId}
                </p>
                <p className="mt-0.5 text-[0.7rem] text-zinc-400">
                  {[r.funnelStage, r.assetType, r.messagingAngle, r.hookTactic]
                    .filter(Boolean)
                    .map((x) => humanize(String(x)))
                    .join(" · ")}
                </p>
                <p className="mt-1 text-xs tabular-nums text-zinc-500">
                  Spend {money(r.spend, cur)} · {metricLabel[d.metric]}{" "}
                  <span className="text-red-500">{fmtMetric(d.metric, r.metricValue, cur)}</span>{" "}
                  · {r.conversions} purchases
                </p>
              </div>
              <Button
                label={
                  loading === r.adId
                    ? "Thinking…"
                    : ideas[r.adId]
                      ? "Regenerate"
                      : "Get iteration ideas"
                }
                size="sm"
                isDisabled={loading === r.adId}
                onClick={() => void getIdeas(r.adId)}
                className="shrink-0"
              />
            </div>
            {errors[r.adId] && (
              <p className="mt-2 text-xs text-red-500">{errors[r.adId]}</p>
            )}
            {ideas[r.adId] && (
              <div className="mt-3 whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-700">
                {ideas[r.adId]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- dispatcher ----

export function CreativeDashboardBody({
  data,
  connectionId,
}: {
  data: CreativeDashboardResult;
  connectionId: string;
}) {
  switch (data.type) {
    case "win_rate":
      return <WinRateView d={data} />;
    case "kill_scale":
      return <KillScaleView d={data} />;
    case "iteration":
      return <IterationView d={data} connectionId={connectionId} />;
  }
}
