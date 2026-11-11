import Link from "next/link";

import { AdsNotConnected } from "@/components/ads/not-connected";
import { requireAdsTeam, adsPath } from "@/lib/ads/access";
import { resolveMetaScope } from "@/lib/ads/scope";
import { loadOverview } from "@/lib/ads/overview";
import { dateRangeParams, parseDateRange, todayIn } from "@/lib/date-range";
import { AdsToolbar } from "./toolbar";
import { AdsBrandCard } from "./brand-card";

/**
 * Every account a specialist runs, side by side.
 *
 * The window ends yesterday and is anchored on the first account's own
 * timezone, because an ad account reports in its own day and today is still
 * being delivered.
 *
 * Rules no longer run on page load. They used to, which meant opening this page
 * with three accounts in scope kicked off six thirty-day scans before anything
 * rendered. They run nightly, and there is a button on Alerts for when you want
 * them now.
 */
export default async function AdsOverviewPage({
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

  const range = parseDateRange(sp, {
    defaultPreset: "28d",
    endsYesterday: true,
    today: todayIn(scope.selected[0]?.timezone ?? "UTC"),
  });

  const overviews = await loadOverview(scope.selected, range, range.prev);

  const seen = new Map<string, string[]>();
  for (const s of scope.selected) {
    seen.set(s.adAccountId, [...(seen.get(s.adAccountId) ?? []), s.brand.name]);
  }
  const duplicateAccounts = [...seen.entries()]
    .filter(([, brands]) => brands.length > 1)
    .map(([adAccountId, brands]) => ({ adAccountId, brands }));

  return (
    <>
      <AdsToolbar
        scope={scope.raw}
        pathname={adsPath(team.slug)}
        query={dateRangeParams(range)}
        range={range}
        badges={Object.fromEntries(
          overviews.map((o) => [
            o.brandSlug,
            o.alerts.critical > 0
              ? [{ label: String(o.alerts.critical), tone: "alert" as const }]
              : o.alerts.open > 0
                ? [{ label: String(o.alerts.open), tone: "warn" as const }]
                : [],
          ]),
        )}
      />

      {/* Two brands pointing at one ad account is a connection mistake, and it
          shows up as two cards with identical numbers. Worth naming: the old
          one-brand-at-a-time view could not reveal it at all. */}
      {duplicateAccounts.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[0.7rem] text-amber-800">
          {duplicateAccounts.map((d) => (
            <p key={d.adAccountId}>
              {d.brands.join(" and ")} are connected to the same ad account (
              {d.adAccountId}), so their figures here are the same numbers twice. An admin
              points each brand at its own account under{" "}
              <Link href="/admin/integrations" className="underline">
                Admin, Integrations
              </Link>
              .
            </p>
          ))}
        </div>
      )}

      {scope.currencies.length > 1 && (
        <p className="mb-3 text-[0.7rem] text-zinc-500">
          This selection spans {scope.currencies.join(" and ")}. Each account is shown in its
          own currency and nothing is summed across them.
        </p>
      )}

      <div className="grid gap-3">
        {overviews.map((overview) => (
          <AdsBrandCard
            key={overview.brandId}
            overview={overview}
            teamSlug={team.slug}
            compareLabel={range.compareLabel}
          />
        ))}
      </div>
    </>
  );
}
