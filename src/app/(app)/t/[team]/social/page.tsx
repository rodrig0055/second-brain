import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { EmptyState } from "@/components/empty-state";
import { requireSocialTeam, socialPath } from "@/lib/social/access";
import { resolveBrandScope } from "@/lib/brand-scope";
import { parseDateRange, dateRangeParams, todayIn } from "@/lib/date-range";
import { loadBrandSummaries } from "@/lib/social/load-summary";
import { loadAttention, pendingByBrand } from "@/lib/social/drafts";
import { SocialToolbar } from "./toolbar";
import { AttentionStrip } from "./attention";
import { BrandCard } from "./brand-card";
import { HowThisWorks } from "./how-this-works";

/**
 * Overview: how every brand you run is doing, and what needs you.
 *
 * Several brands at once by default, because that is the job. The window ends
 * yesterday: today is still accruing, and a half-day makes every brand look
 * like it had a bad one.
 */
export default async function SocialOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team, brands, unconnected } = await requireSocialTeam(teamSlug);

  if (brands.length === 0) {
    return (
      <EmptyState
        icon={<Send className="size-4" />}
        title="No connected social account"
        description={
          unconnected.length
            ? `None of your brands has a social account connected yet (${unconnected.map((b) => b.name).join(", ")}).`
            : "You do not have access to a brand with a social account yet."
        }
        action={
          <Button label="Go to Connections" variant="primary" href={socialPath("connections")} />
        }
      />
    );
  }

  const scope = await resolveBrandScope({ user, teamSlug: team.slug, searchParams: sp });
  const range = parseDateRange(sp, { defaultPreset: "28d", endsYesterday: true });
  const selectedIds = scope.selected.map((b) => b.id);

  const [summaries, attention, pending] = await Promise.all([
    loadBrandSummaries(selectedIds, range, range.prev),
    loadAttention(selectedIds, todayIn()),
    pendingByBrand(scope.all.map((b) => b.id)),
  ]);

  const byBrand = new Map(summaries.map((s) => [s.brandId, s]));
  const nothingYet = summaries.every(
    (s) => s.instagram.posts === 0 && s.facebook.posts === 0 && !s.instagram.reach,
  );

  return (
    <>
      <SocialToolbar
        scope={scope}
        pathname={socialPath()}
        query={dateRangeParams(range)}
        range={range}
        presets={["7d", "28d", "30d", "90d"]}
        badges={Object.fromEntries(
          scope.all.map((b) => [
            b.slug,
            pending[b.id] ? [{ label: String(pending[b.id]), tone: "warn" as const }] : [],
          ]),
        )}
      />

      <HowThisWorks open={nothingYet} />

      <AttentionStrip attention={attention} />

      <div className="grid gap-3">
        {scope.selected.map((scoped) => {
          // The scope returns plain brands; the card wants the connection with
          // it, which requireSocialTeam already resolved.
          const brand = brands.find((b) => b.id === scoped.id);
          const summary = byBrand.get(scoped.id);
          if (!brand || !summary) return null;
          return (
            <BrandCard
              key={brand.id}
              brand={brand}
              summary={summary}
              compareLabel={range.compareLabel}
              pendingCount={pending[brand.id] ?? 0}
            />
          );
        })}
      </div>

      {unconnected.length > 0 && (
        <Link
          href={socialPath("connections")}
          className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
        >
          <span>
            {unconnected.length} brand{unconnected.length === 1 ? "" : "s"} not connected yet:{" "}
            {unconnected.map((b) => b.name).join(", ")}
          </span>
          <span className="shrink-0 font-medium text-zinc-900">View connections →</span>
        </Link>
      )}
    </>
  );
}
