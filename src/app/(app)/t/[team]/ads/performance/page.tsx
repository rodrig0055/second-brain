import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AdsNotConnected } from "@/components/ads/not-connected";
import { adsPath, requireAdsTeam } from "@/lib/ads/access";
import { resolveMetaScope } from "@/lib/ads/scope";
import { loadPivot, type PivotRow } from "@/lib/ads/store";
import { dateRangeParams, parseDateRange, todayIn } from "@/lib/date-range";
import { AdsToolbar } from "../toolbar";
import { PerformanceTable } from "@/components/ads/performance-table";
import { PerformanceFilters } from "./filters";

/**
 * Every campaign, ad set or ad in the window, across the accounts in scope.
 *
 * Drilling in narrows the query rather than the result: `campaign` and `adset`
 * go into the SQL, so opening one campaign on a big account does not read the
 * whole account to throw most of it away.
 */
export default async function AdsPerformancePage({
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

  const level = (["campaign", "adset", "ad"].includes(one("level")) ? one("level") : "ad") as
    | "campaign"
    | "adset"
    | "ad";
  const campaign = one("campaign");
  const adset = one("adset");
  const funnel = one("funnel");
  const status = one("status");
  const objective = one("objective");
  const minSpend = Number(one("minSpend")) || 0;

  const range = parseDateRange(sp, {
    defaultPreset: "7d",
    endsYesterday: true,
    today: todayIn(scope.selected[0]?.timezone ?? "UTC"),
  });

  const perAccount = await Promise.all(
    scope.selected.map((account) =>
      loadPivot({
        connectionId: account.connection.id,
        brandId: account.brand.id,
        level,
        range,
        prev: range.prev,
        currency: account.currency,
        filter: {
          campaignId: campaign || undefined,
          adSetId: adset || undefined,
        },
        brand: { name: account.brand.name, slug: account.brand.slug },
        adAccountId: account.adAccountId,
        writeOk: account.writeGate.ok,
      }),
    ),
  );

  let rows: PivotRow[] = perAccount.flat();

  if (funnel) {
    rows =
      funnel === "unmapped"
        ? rows.filter((r) => !r.funnel)
        : funnel === "review"
          ? rows.filter((r) => r.funnelNeedsReview)
          : rows.filter((r) => r.funnel === funnel);
  }
  if (status) rows = rows.filter((r) => r.status === status);
  if (objective) rows = rows.filter((r) => r.objective === objective);
  if (minSpend > 0) rows = rows.filter((r) => r.totals.spend >= minSpend);
  rows.sort((a, b) => b.totals.spend - a.totals.spend);

  const base = `${adsPath(team.slug)}/performance`;
  const keep = { brands: scope.param, ...dateRangeParams(range) };
  const linkTo = (next: Record<string, string>) =>
    `${base}?${new URLSearchParams({ ...keep, ...next })}`;

  // Names come off the first row rather than a second query.
  const drillCampaign = campaign ? (rows[0]?.campaignName ?? campaign) : "";
  const drillAdSet = adset ? (rows[0]?.adSetName ?? adset) : "";

  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))].sort();
  const objectives = [...new Set(rows.map((r) => r.objective).filter(Boolean))].sort();

  return (
    <>
      <AdsToolbar
        scope={scope.raw}
        pathname={base}
        query={{
          ...dateRangeParams(range),
          level,
          ...(campaign ? { campaign } : {}),
          ...(adset ? { adset } : {}),
        }}
        range={range}
      >
        <PerformanceFilters statuses={statuses} objectives={objectives} />
      </AdsToolbar>

      <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <Link href={linkTo({ level: "campaign" })} className="hover:text-zinc-800">
          All campaigns
        </Link>
        {drillCampaign && (
          <>
            <ChevronRight className="size-3" />
            <Link
              href={linkTo({ level: "adset", campaign })}
              className="max-w-xs truncate hover:text-zinc-800"
            >
              {drillCampaign}
            </Link>
          </>
        )}
        {drillAdSet && (
          <>
            <ChevronRight className="size-3" />
            <span className="max-w-xs truncate text-zinc-800">{drillAdSet}</span>
          </>
        )}
        <span className="grow" />
        <span className="flex gap-1">
          {(["campaign", "adset", "ad"] as const).map((l) => (
            <Link
              key={l}
              href={linkTo({ level: l })}
              className={`rounded px-2 py-1 ${
                l === level ? "bg-zinc-900 text-zinc-50" : "border border-zinc-200 bg-white hover:bg-zinc-50"
              }`}
            >
              {l === "campaign" ? "Campaigns" : l === "adset" ? "Ad sets" : "Ads"}
            </Link>
          ))}
        </span>
      </nav>

      <div>
        <PerformanceTable
          rows={rows}
          level={level}
          teamSlug={team.slug}
          multiBrand={scope.selected.length > 1}
          compare={range.compare}
          range={{ start: range.start, end: range.end }}
          mixedCurrency={scope.currencies.length > 1}
        />
      </div>
    </>
  );
}
