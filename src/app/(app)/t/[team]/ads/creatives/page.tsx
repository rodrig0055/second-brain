import Link from "next/link";

import { AdsNotConnected } from "@/components/ads/not-connected";
import { adsPath, requireAdsTeam } from "@/lib/ads/access";
import { resolveMetaScope } from "@/lib/ads/scope";
import { loadCreativeLibrary, toAdRow } from "@/lib/ads/creatives/library";
import { dateRangeParams, parseDateRange, todayIn } from "@/lib/date-range";
import {
  buildIteration,
  buildKillScale,
  buildWinRate,
} from "@/lib/integrations/meta/creative-dashboards";
import { EVAL_METRICS, type EvalMetric } from "@/lib/integrations/meta/creative-dashboard-types";
import { AdsToolbar } from "../toolbar";
import { WinFilter } from "./win-filter";
import { CreativeLibrary } from "@/components/ads/creative-library";
import { CreativeViews } from "@/components/ads/creative-views";
import { AnalyzeNow } from "@/components/ads/analyze-now";

/**
 * Every creative that spent in the window, and what it says about what works.
 *
 * Built on the same pivot the Performance tab reads, so an ad's spend here and
 * its spend there are the same number. The dashboards used to compute their own
 * totals from the raw rows, which meant the two surfaces could disagree about
 * the same ad and both look right.
 */

const DEFAULT_THRESHOLDS: Record<EvalMetric, number> = {
  roas: 1.5,
  cpa: 20,
  ctr: 1,
  purchases: 1,
};

const VIEWS = [
  { key: "library", label: "Library" },
  { key: "winrate", label: "What wins" },
  { key: "killscale", label: "Kill or scale" },
  { key: "iterate", label: "Iterate" },
] as const;

export default async function AdsCreativesPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team } = await requireAdsTeam(teamSlug);
  const scope = await resolveMetaScope(user, sp);

  if (scope.all.length === 0) {
    return (
      <AdsNotConnected />
    );
  }

  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const view = (VIEWS.find((v) => v.key === one("view"))?.key ?? "library") as
    (typeof VIEWS)[number]["key"];
  const metric = (EVAL_METRICS.includes(one("metric") as EvalMetric)
    ? one("metric")
    : "roas") as EvalMetric;
  const threshold = Number(one("threshold")) || DEFAULT_THRESHOLDS[metric];
  const minSpend = Number(one("minSpend")) || 0;

  const range = parseDateRange(sp, {
    defaultPreset: "30d",
    endsYesterday: true,
    today: todayIn(scope.selected[0]?.timezone ?? "UTC"),
  });

  const { rows, unclassified } = await loadCreativeLibrary({
    scope: scope.selected,
    range,
    metric,
    threshold,
  });

  const base = `${adsPath(team.slug)}/creatives`;
  const keep = {
    brands: scope.param,
    ...dateRangeParams(range),
    metric,
    threshold: String(threshold),
  };
  const linkTo = (next: Record<string, string>) =>
    `${base}?${new URLSearchParams({ ...keep, ...next })}`;

  const currency = scope.currencies.length === 1 ? scope.currencies[0] : "";
  const adRows = rows.map(toAdRow);
  const dashboards =
    view === "winrate"
      ? buildWinRate(adRows, metric, threshold, currency)
      : view === "killscale"
        ? buildKillScale(adRows, metric, threshold, currency, minSpend)
        : view === "iterate"
          ? buildIteration(adRows, metric, threshold, currency, minSpend)
          : null;

  return (
    <>
      <AdsToolbar
        scope={scope.raw}
        pathname={base}
        query={{ ...dateRangeParams(range), view, metric, threshold: String(threshold) }}
        range={range}
      >
        <WinFilter metric={metric} threshold={threshold} />
      </AdsToolbar>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1.5">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={linkTo({ view: v.key })}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                v.key === view
                  ? "bg-zinc-900 text-zinc-50"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </nav>


        <div className="grow" />
        <AnalyzeNow
          connections={scope.selected.map((s) => ({
            id: s.connection.id,
            brandId: s.brand.id,
            name: s.brand.name,
          }))}
          range={{ start: range.start, end: range.end }}
          unclassified={unclassified}
        />
      </div>

      {metric === "cpa" && scope.currencies.length > 1 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[0.7rem] text-amber-800">
          This selection spans {scope.currencies.join(" and ")}, and a CPA threshold is a money
          figure. One number cannot judge both accounts. Pick a single account, or judge on ROAS.
        </p>
      )}

      {view === "library" ? (
        <CreativeLibrary
          rows={rows}
          teamSlug={team.slug}
          multiBrand={scope.selected.length > 1}
        />
      ) : (
        dashboards && (
          <CreativeViews
            result={dashboards}
            teamSlug={team.slug}
            // Iteration ideas are asked of one account's brain, so a
            // multi-account scope uses the first.
            connectionId={scope.selected[0]?.connection.id}
          />
        )
      )}
    </>
  );
}
