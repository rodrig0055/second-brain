import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { brandTone } from "@/lib/brand-tone";
import type { BrandOverview } from "@/lib/ads/overview";
import { adsPath } from "@/lib/ads/access";

/**
 * One ad account.
 *
 * Its own currency, its own totals, never blended with the account next to it:
 * there is no FX anywhere in this app, so a combined figure across a PHP and a
 * USD account would be invented.
 */
export function AdsBrandCard({
  overview,
  teamSlug,
  compareLabel,
}: {
  overview: BrandOverview;
  teamSlug: string;
  compareLabel?: string;
}) {
  const t = overview.totals;
  const p = overview.prevTotals;
  const tone = brandTone(overview.brandSlug);
  const perf = (extra: Record<string, string>) =>
    `${adsPath(teamSlug)}/performance?${new URLSearchParams({ brands: overview.brandSlug, ...extra })}`;

  return (
    <section className="animate-enter rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
        <h2 className="text-sm font-semibold text-zinc-900">{overview.brandName}</h2>
        <span className="text-[0.7rem] text-zinc-400">
          {overview.adAccountId} · {overview.currency}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
            overview.writeGate.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-zinc-100 text-zinc-500"
          }`}
          title={overview.writeGate.ok ? "Pause and activate work from here" : overview.writeGate.reason}
        >
          {overview.writeGate.ok ? "Writes on" : "Read-only"}
        </span>
        <div className="grow" />
        {overview.alerts.open > 0 && (
          <Link
            href={`${adsPath(teamSlug)}/alerts?brands=${overview.brandSlug}`}
            className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
              overview.alerts.critical > 0
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            {overview.alerts.open} open
            {overview.alerts.critical > 0 ? `, ${overview.alerts.critical} to kill` : ""}
          </Link>
        )}
        <Button href={perf({})} label="Performance" variant="primary" size="sm" />
      </header>

      <KpiGrid cols={4}>
        <KpiTile size="sm" label="Spend" value={t.spend} format="money" currency={overview.currency} previous={p?.spend} compareLabel={compareLabel} invert />
        <KpiTile size="sm" label="Purchases" value={t.purchases} previous={p?.purchases} compareLabel={compareLabel} />
        <KpiTile size="sm" label="Value" value={t.purchaseValue} format="money" currency={overview.currency} previous={p?.purchaseValue} compareLabel={compareLabel} />
        <KpiTile size="sm" label="CIR" value={t.cir} format={(v) => `${v.toFixed(0)}%`} previous={p?.cir} compareLabel={compareLabel} invert hint="spend ÷ value" />
        <KpiTile size="sm" label="ROAS" value={t.roas} format="ratio" previous={p?.roas} compareLabel={compareLabel} />
        <KpiTile size="sm" label="CPA" value={t.cpp} format="money" currency={overview.currency} previous={p?.cpp} compareLabel={compareLabel} invert />
        <KpiTile size="sm" label="CTR" value={t.ctr} format={(v) => `${v.toFixed(2)}%`} previous={p?.ctr} compareLabel={compareLabel} />
        {/* Not frequency: reach cannot be summed across days, so an
            account-level frequency over a window would be a number with no
            defensible meaning. AOV is properly derived from two sums. */}
        <KpiTile size="sm" label="AOV" value={t.aov} format="money" currency={overview.currency} previous={p?.aov} compareLabel={compareLabel} />
      </KpiGrid>

      {overview.funnels.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <p className="mb-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-zinc-400">
            Funnel
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.funnels.map((f) => (
              <Link
                key={f.funnel}
                href={perf({ funnel: f.funnel === "UNMAPPED" ? "unmapped" : f.funnel })}
                className={`rounded-lg border px-2.5 py-1.5 text-[0.7rem] ${
                  f.funnel === "UNMAPPED"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : f.overTarget
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-zinc-200 bg-white text-zinc-700"
                }`}
              >
                <span className="font-medium">{f.funnel}</span>{" "}
                <span className="tabular-nums">
                  {f.totals.spend.toLocaleString("en-PH", { maximumFractionDigits: 0 })}{" "}
                  {overview.currency}
                </span>
                <span className="tabular-nums"> · CIR {f.totals.cir.toFixed(0)}%</span>
                {f.targetCirPct !== null && (
                  <span className="text-[0.65rem] opacity-70">
                    {" "}
                    vs {f.targetCirPct}%{f.targetConfirmed ? "" : " (inherited)"}
                  </span>
                )}
              </Link>
            ))}
          </div>
          {overview.unmappedSpend > 0 && (
            <p className="mt-1.5 text-[0.7rem] text-amber-700">
              {overview.unmappedSpend.toLocaleString("en-PH", { maximumFractionDigits: 0 })}{" "}
              {overview.currency} is on ad sets with no funnel, so it is missing from every
              funnel figure above.{" "}
              <Link
                href={perf({ level: "adset", funnel: "unmapped" })}
                className="underline hover:text-amber-900"
              >
                Set them
              </Link>
            </p>
          )}
        </div>
      )}

      {overview.digest && (
        <details className="mt-3 border-t border-zinc-100 pt-3">
          <summary className="cursor-pointer text-[0.7rem] font-medium text-zinc-600">
            {overview.digest.report.title}
          </summary>
          <div className="mt-2 grid gap-2">
            {overview.digest.report.sections.map((s) => (
              <div key={s.heading}>
                <p className="text-[0.7rem] font-medium text-zinc-700">{s.heading}</p>
                <p className="whitespace-pre-wrap text-[0.7rem] leading-4 text-zinc-500">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.65rem] text-zinc-400">
        {overview.lastSyncAt
          ? `Synced ${overview.lastSyncAt.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "Never synced"}
        {overview.actions.pending > 0 && (
          <Link href={`${adsPath(teamSlug)}/alerts?brands=${overview.brandSlug}`} className="text-amber-700 hover:underline">
            {overview.actions.pending} waiting for you
          </Link>
        )}
        <a
          href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${overview.adAccountId.replace(/^act_/, "")}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-zinc-700"
        >
          <ExternalLink className="size-3" />
          Ads Manager
        </a>
      </p>
    </section>
  );
}
