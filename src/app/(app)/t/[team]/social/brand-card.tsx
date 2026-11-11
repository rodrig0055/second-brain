import { ExternalLink } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { KpiTile } from "@/components/kpi-tile";
import { brandTone } from "@/lib/brand-tone";
import type { BrandSummary } from "@/lib/social/summary";
import type { SocialBrand } from "@/lib/social/access";
import { socialPath } from "@/lib/social/access";
import type { SocialPost } from "@/lib/social/metrics";
import { ToneTag } from "@/components/status-badge";

/**
 * One brand's fortnight.
 *
 * Instagram and Facebook sit in separate columns and never share a row,
 * because they do not measure the same thing. Facebook has no reach on this API
 * version and never will, so the tile is absent rather than zero: a zero would
 * read as "nobody saw it", which is a different and wrong claim.
 */
export function BrandCard({
  brand,
  summary,
  compareLabel,
  pendingCount,
}: {
  brand: SocialBrand;
  summary: BrandSummary;
  compareLabel?: string;
  pendingCount: number;
}) {
  const tone = brandTone(brand.slug);
  const ig = summary.instagram;
  const fb = summary.facebook;
  const broken = brand.connection?.status === "error";

  return (
    <section className="animate-enter rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
        <h2 className="text-sm font-semibold text-zinc-900">{brand.name}</h2>
        {brand.connection?.igUsername && (
          <span className="text-[0.7rem] text-zinc-400">@{brand.connection.igUsername}</span>
        )}
        {broken && (
          <ToneTag tone="danger" label="Connection needs attention" />
        )}
        <div className="grow" />
        {pendingCount > 0 && (
          <ToneTag tone="attention" href={socialPath("drafts", { brands: brand.slug })} label={`${pendingCount} waiting`} />
        )}
        <Button
          label="Compose"
          variant="primary"
          size="sm"
          href={socialPath("compose", { brand: brand.id })}
        />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Channel
          label="Instagram"
          tiles={[
            { label: "Followers", value: ig.followers },
            { label: "Gained", value: ig.followersGained, previous: prev(summary, "igGained", ig.followersGained) },
            { label: "Reach", value: ig.reach, hint: "daily, summed", previous: prev(summary, "igReach", ig.reach ?? 0) },
            { label: "Posts", value: ig.posts, previous: prev(summary, "igPosts", ig.posts) },
          ]}
          compareLabel={compareLabel}
          best={ig.bestPost}
          bestMetric={(p) => p.engagementRate ?? "—"}
          bestLabel="best rate"
          emptyBest="No post cleared 50 reach, so a rate would be noise."
        />
        <Channel
          label="Facebook Page"
          tiles={[
            { label: "Followers", value: fb.followers },
            { label: "Gained", value: fb.followersGained, previous: prev(summary, "fbGained", fb.followersGained) },
            { label: "Page views", value: fb.pageViews, previous: prev(summary, "fbPageViews", fb.pageViews ?? 0) },
            { label: "Posts", value: fb.posts, previous: prev(summary, "fbPosts", fb.posts) },
          ]}
          compareLabel={compareLabel}
          best={fb.bestPost}
          bestMetric={(p) => `${p.engagement.toLocaleString("en-PH")} eng.`}
          bestLabel="most engagement"
          emptyBest="No posts in this window."
          footnote={`${fb.engagement.toLocaleString("en-PH")} post engagements. Facebook reports no reach.`}
        />
      </div>
    </section>
  );
}

/** Turn a delta back into the previous value, which is what KpiTile compares. */
function prev(summary: BrandSummary, key: string, current: number): number | undefined {
  const d = summary.deltas[key];
  if (!d) return undefined;
  const previous = current - d.abs;
  return previous > 0 ? previous : undefined;
}

function Channel({
  label,
  tiles,
  compareLabel,
  best,
  bestMetric,
  bestLabel,
  emptyBest,
  footnote,
}: {
  label: string;
  tiles: { label: string; value: number | null; hint?: string; previous?: number }[];
  compareLabel?: string;
  best: SocialPost | null;
  bestMetric: (post: SocialPost) => string;
  bestLabel: string;
  emptyBest: string;
  footnote?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[0.7rem] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <div className="grid grid-cols-4 gap-3">
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            size="sm"
            label={t.label}
            value={t.value}
            hint={t.hint}
            previous={t.previous}
            compareLabel={t.previous !== undefined ? compareLabel : undefined}
          />
        ))}
      </div>

      <div className="mt-3 border-t border-zinc-100 pt-2.5">
        {best ? (
          <div className="flex min-w-0 items-baseline gap-2 text-[0.7rem]">
            <span className="shrink-0 font-medium tabular-nums text-zinc-900">
              {bestMetric(best)}
            </span>
            <span className="shrink-0 text-zinc-400">{bestLabel}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-600">
              {best.caption || "(no caption)"}
            </span>
            {best.permalink && (
              <a
                href={best.permalink}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-zinc-400 hover:text-zinc-700"
              >
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ) : (
          <p className="text-[0.7rem] text-zinc-400">{emptyBest}</p>
        )}
        {footnote && <p className="mt-1.5 text-[0.65rem] text-zinc-400">{footnote}</p>}
      </div>
    </div>
  );
}
