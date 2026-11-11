"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { CHART, axisProps, dayTick, gridProps } from "@/lib/insights/chart-theme";
import type {
  AccountHealth,
  AnomalyReport,
  AuctionInsights,
  BudgetAllocation,
  PmaxBreakdown,
  QualityScore,
  SearchWaste,
} from "@/lib/integrations/google_ads/dashboards";
import { KpiTile } from "@/components/kpi-tile";

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
const num = (v: number) => v.toLocaleString("en-PH", { maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);
const ratio = (v: number | null) => (v === null ? "N/A" : `${v.toFixed(2)}×`);

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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      {children}
    </p>
  );
}

// ---- 1. Account health ----

export function AccountHealthView({ d }: { d: AccountHealth }) {
  const { currency: cur, kpis } = d;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Spend" value={money(kpis.spend, cur)} />
        <KpiTile label="Revenue" definition="Conversion value Google Ads attributes to the ads." value={money(kpis.revenue, cur)} />
        <KpiTile label="ROAS" value={ratio(kpis.roas)} />
        <KpiTile label="CPA" value={kpis.cpa === null ? "N/A" : money(kpis.cpa, cur, 2)} />
        <KpiTile label="CTR" value={pct(kpis.ctr)} />
        <KpiTile label="Conversions" value={num(kpis.conversions)} />
      </div>

      <SectionTitle>Spend vs revenue</SectionTitle>
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={d.series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={dayTick} {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={48} />
            <Tooltip
              formatter={(v, name) => [money(Number(v), cur), name === "spend" ? "Spend" : "Revenue"]}
              labelClassName="text-xs"
            />
            <Line type="monotone" dataKey="revenue" stroke={CHART.revenue} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="spend" stroke={CHART.spend} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle>Campaigns by spend</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-left text-xs">
          <tr>
            <Th>Campaign</Th>
            <Th right>Spend</Th>
            <Th right>Revenue</Th>
            <Th right>ROAS</Th>
            <Th right>CPA</Th>
            <Th right>CTR</Th>
            <Th right>Conv.</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.campaigns.length === 0 && <EmptyRow cols={7} text="No campaign data in this range." />}
          {d.campaigns.map((c) => (
            <tr key={c.id} className="hover:bg-zinc-50">
              <Td>{c.name}</Td>
              <Td right>{money(c.spend, cur)}</Td>
              <Td right>{money(c.revenue, cur)}</Td>
              <Td right tone={c.roas !== null && c.roas >= 1 ? "good" : c.spend > 0 ? "bad" : "muted"}>
                {ratio(c.roas)}
              </Td>
              <Td right>{c.cpa === null ? "N/A" : money(c.cpa, cur, 2)}</Td>
              <Td right>{pct(c.ctr)}</Td>
              <Td right>{num(c.conversions)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

// ---- 2. PMax breakdown ----

export function PmaxView({ d }: { d: PmaxBreakdown }) {
  const cur = d.currency;
  const chartData = d.assetGroups.slice(0, 12).map((g) => ({ name: g.name, roas: g.roas ?? 0 }));
  return (
    <div className="space-y-2">
      {d.notes.map((note, i) => (
        <Note key={i}>{note}</Note>
      ))}

      {chartData.length > 0 && (
        <>
          <SectionTitle>Asset group ROAS</SectionTitle>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card">
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 30)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 12, right: 16 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="name" width={140} {...axisProps} />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}×`, "ROAS"]} />
                <Bar dataKey="roas" radius={[0, 4, 4, 0]}>
                  {chartData.map((row, i) => (
                    <Cell key={i} fill={row.roas >= 1 ? CHART.revenue : CHART.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <SectionTitle>Asset groups</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-xs">
          <tr>
            <Th>Campaign</Th>
            <Th>Asset group</Th>
            <Th right>Spend</Th>
            <Th right>Revenue</Th>
            <Th right>ROAS</Th>
            <Th right>Conv.</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.assetGroups.length === 0 && <EmptyRow cols={6} text="No asset groups." />}
          {d.assetGroups.map((g, i) => (
            <tr key={i} className="hover:bg-zinc-50">
              <Td>{g.campaignName}</Td>
              <Td>{g.name}</Td>
              <Td right>{money(g.spend, cur)}</Td>
              <Td right>{money(g.revenue, cur)}</Td>
              <Td right tone={g.roas !== null && g.roas >= 1 ? "good" : g.spend > 0 ? "bad" : "muted"}>
                {ratio(g.roas)}
              </Td>
              <Td right>{num(g.conversions)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {d.categories.length > 0 && (
        <>
          <SectionTitle>Search categories (what Google matched you to)</SectionTitle>
          <TableShell>
            <thead className="sticky top-0 bg-zinc-50 text-xs">
              <tr>
                <Th>Category</Th>
                <Th right>Impressions</Th>
                <Th right>Clicks</Th>
                <Th right>Conv.</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {d.categories.map((c, i) => (
                <tr key={i} className="hover:bg-zinc-50">
                  <Td>{c.label}</Td>
                  <Td right>{num(c.impressions)}</Td>
                  <Td right>{num(c.clicks)}</Td>
                  <Td right>{num(c.conversions)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}

      {d.lowAssets.length > 0 && (
        <>
          <SectionTitle>Low-performing assets</SectionTitle>
          <TableShell>
            <thead className="sticky top-0 bg-zinc-50 text-xs">
              <tr>
                <Th>Asset group</Th>
                <Th>Field</Th>
                <Th>Type</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {d.lowAssets.map((a, i) => (
                <tr key={i} className="hover:bg-zinc-50">
                  <Td>{a.assetGroup}</Td>
                  <Td tone="bad">{a.fieldType}</Td>
                  <Td>{a.type}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}

// ---- 3. Quality Score ----

export function QualityScoreView({ d }: { d: QualityScore }) {
  const cur = d.currency;
  const scored = d.keywords.filter((k) => k.qs > 0);
  const good = scored.filter((k) => k.qs > 4).map((k) => ({ ...k }));
  const bad = scored.filter((k) => k.qs <= 4).map((k) => ({ ...k }));
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Keywords scored" definition="Keywords Google has given a Quality Score, from 1 to 10." value={num(scored.length)} />
        <KpiTile label="Low QS (≤4)" definition="Keywords with a Quality Score of 4 or less. They pay more per click for worse positions." value={num(bad.length)} />
        <KpiTile
          label="Spend on low QS" definition="What the keywords with a Quality Score of 4 or less cost in this period."
          value={money(bad.reduce((s, k) => s + k.spend, 0), cur)}
        />
        <KpiTile
          label="Avg QS" definition="The mean Quality Score of the scored keywords, not weighted by spend."
          value={scored.length ? (scored.reduce((s, k) => s + k.qs, 0) / scored.length).toFixed(1) : "N/A"}
        />
      </div>

      <SectionTitle>Quality Score vs spend</SectionTitle>
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card">
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              type="number"
              dataKey="qs"
              name="Quality Score"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              {...axisProps}
            />
            <YAxis type="number" dataKey="spend" name="Spend" width={52} {...axisProps} />
            <ZAxis range={[40, 40]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(v, name) =>
                name === "Spend" ? [money(Number(v), cur), "Spend"] : [String(v), "QS"]
              }
              labelClassName="text-xs"
            />
            <Scatter name="QS > 4" data={good} fill={CHART.spend} fillOpacity={0.7} />
            <Scatter name="QS ≤ 4" data={bad} fill={CHART.negative} />
          </ScatterChart>
        </ResponsiveContainer>
        <p className="mt-1 text-center text-[0.7rem] text-zinc-400">
          Each dot is a keyword · red = Quality Score ≤ 4
        </p>
      </div>

      <SectionTitle>Worst offenders (low QS, high spend)</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-xs">
          <tr>
            <Th>Keyword</Th>
            <Th right>QS</Th>
            <Th right>Spend</Th>
            <Th right>Clicks</Th>
            <Th right>Conv.</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.flagged.length === 0 && <EmptyRow cols={5} text="No low-QS keywords with spend. 🎉" />}
          {d.flagged.map((k) => {
            const full = d.keywords.find((x) => x.keyword === k.keyword);
            return (
              <tr key={k.keyword} className="hover:bg-zinc-50">
                <Td>{k.keyword}</Td>
                <Td right tone="bad">{k.qs}</Td>
                <Td right>{money(k.spend, cur)}</Td>
                <Td right>{num(full?.clicks ?? 0)}</Td>
                <Td right>{num(full?.conversions ?? 0)}</Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}

// ---- 4. Search-term waste ----

export function SearchWasteView({ d }: { d: SearchWaste }) {
  const cur = d.currency;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiTile label="Spend on search terms" definition="What the searches that triggered the ads cost in this period." value={money(d.totalSpend, cur)} />
        <KpiTile
          label="Wasted (0 conversions)" definition="Spend on the search terms that brought no conversion (the 50 costliest)."
          value={money(d.totalWasted, cur)}
          hint={d.totalSpend > 0 ? `${((d.totalWasted / d.totalSpend) * 100).toFixed(0)}% of spend` : undefined}
        />
        <KpiTile label="Negatives suggested" definition="Search terms that spent without converting, up to 50: candidates for negative keywords." value={num(d.suggestedNegatives.length)} />
      </div>

      <SectionTitle>Top search terms by cost</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-xs">
          <tr>
            <Th>Search term</Th>
            <Th right>Spend</Th>
            <Th right>Clicks</Th>
            <Th right>Conv.</Th>
            <Th right>Revenue</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.terms.length === 0 && <EmptyRow cols={5} text="No search terms with spend in this range." />}
          {d.terms.map((t) => (
            <tr key={t.term} className="hover:bg-zinc-50">
              <Td tone={t.conversions === 0 ? "bad" : undefined}>{t.term}</Td>
              <Td right>{money(t.spend, cur)}</Td>
              <Td right>{num(t.clicks)}</Td>
              <Td right tone={t.conversions === 0 ? "bad" : "good"}>{num(t.conversions)}</Td>
              <Td right>{money(t.revenue, cur)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <p className="mt-2 text-xs text-zinc-500">
        Rows in red spent money with zero conversions, candidates for negative keywords.
      </p>
    </div>
  );
}

// ---- 5. Budget allocation ----

export function BudgetView({ d }: { d: BudgetAllocation }) {
  const cur = d.currency;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiTile label="Current ROAS" value={ratio(d.currentRoas)} />
        <KpiTile label="Projected ROAS" value={ratio(d.projectedRoas)} />
        <KpiTile
          label="Projected lift" definition="Projected ROAS minus current ROAS."
          value={d.roasLift === null ? "N/A" : `${d.roasLift >= 0 ? "+" : ""}${d.roasLift.toFixed(2)}×`}
        />
      </div>

      <SectionTitle>Current vs recommended budget split</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-xs">
          <tr>
            <Th>Campaign</Th>
            <Th right>ROAS</Th>
            <Th right>Current</Th>
            <Th right>Recommended</Th>
            <Th right>Shift</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.campaigns.length === 0 && <EmptyRow cols={5} text="No campaigns with spend." />}
          {d.campaigns.map((c) => (
            <tr key={c.name} className="hover:bg-zinc-50">
              <Td>{c.name}</Td>
              <Td right tone={c.roas !== null && c.roas >= 1 ? "good" : "bad"}>{ratio(c.roas)}</Td>
              <Td right>
                {money(c.spend, cur)}
                <span className="ml-1 text-[0.7rem] text-zinc-400">({(c.currentShare * 100).toFixed(0)}%)</span>
              </Td>
              <Td right>
                {money(c.recommendedSpend, cur)}
                <span className="ml-1 text-[0.7rem] text-zinc-400">({(c.recommendedShare * 100).toFixed(0)}%)</span>
              </Td>
              <Td right tone={c.delta > 0 ? "good" : c.delta < 0 ? "bad" : "muted"}>
                {c.delta >= 0 ? "+" : ""}
                {money(c.delta, cur)}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Note>{d.note}</Note>
    </div>
  );
}

// ---- 6. Auction / impression share ----

export function AuctionView({ d }: { d: AuctionInsights }) {
  const chart = d.series.map((s) => ({
    date: s.date,
    is: s.impressionShare === null ? null : s.impressionShare * 100,
    rank: s.rankLostIS === null ? null : s.rankLostIS * 100,
    budget: s.budgetLostIS === null ? null : s.budgetLostIS * 100,
  }));
  return (
    <div>
      <Note>{d.note}</Note>

      <SectionTitle>Impression share over time</SectionTitle>
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-card">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={dayTick} {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={40} unit="%" domain={[0, 100]} />
            <Tooltip
              formatter={(v, name) => [
                `${Number(v).toFixed(1)}%`,
                name === "is" ? "Impression share" : name === "rank" ? "Lost to rank" : "Lost to budget",
              ]}
              labelClassName="text-xs"
            />
            <Line type="monotone" dataKey="is" stroke={CHART.revenue} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="rank" stroke={CHART.negative} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="budget" stroke={CHART.spend} strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-1 text-center text-[0.7rem] text-zinc-400">
          Green = impression share · red = lost to rank · grey = lost to budget
        </p>
      </div>

      <SectionTitle>By campaign</SectionTitle>
      <TableShell>
        <thead className="sticky top-0 bg-zinc-50 text-xs">
          <tr>
            <Th>Campaign</Th>
            <Th right>Impr. share</Th>
            <Th right>Lost to rank</Th>
            <Th right>Lost to budget</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {d.campaigns.length === 0 && (
            <EmptyRow cols={4} text="No Search campaigns with impression-share data." />
          )}
          {d.campaigns.map((c) => (
            <tr key={c.name} className="hover:bg-zinc-50">
              <Td>{c.name}</Td>
              <Td right tone="good">{pct(c.impressionShare)}</Td>
              <Td right tone={c.rankLostIS && c.rankLostIS > 0.2 ? "bad" : undefined}>{pct(c.rankLostIS)}</Td>
              <Td right tone={c.budgetLostIS && c.budgetLostIS > 0.1 ? "bad" : undefined}>{pct(c.budgetLostIS)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

// ---- 7. Weekly anomaly report ----

export function AnomalyView({ d }: { d: AnomalyReport }) {
  const cur = d.currency;
  const fmt = (v: number, f: AnomalyReport["metrics"][number]["format"]) =>
    f === "money" ? money(v, cur, 2) : f === "percent" ? pct(v) : f === "ratio" ? ratio(v) : num(v);
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-600">
        Last 7 days vs the previous 7 days. Moves greater than 15% are flagged.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {d.metrics.map((m) => {
          const up = m.deltaPct !== null && m.deltaPct >= 0;
          const good = m.deltaPct === null ? null : m.invert ? !up : up;
          const tone = !m.flagged
            ? "text-zinc-500"
            : good
              ? "text-emerald-700"
              : "text-red-500";
          return (
            <div
              key={m.label}
              className={`flex items-center justify-between rounded-lg border bg-white px-4 py-3 shadow-card ${
                m.flagged && !good ? "border-red-200" : "border-zinc-200"
              }`}
            >
              <div>
                <p className="text-xs text-zinc-500">{m.label}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-zinc-900">
                  {fmt(m.thisWeek, m.format)}
                </p>
                <p className="text-[0.7rem] text-zinc-400">was {fmt(m.lastWeek, m.format)}</p>
              </div>
              <div className={`text-sm font-medium tabular-nums ${tone}`}>
                {m.deltaPct === null ? "N/A" : `${up ? "↑" : "↓"} ${Math.abs(m.deltaPct * 100).toFixed(0)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
