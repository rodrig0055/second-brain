import "server-only";

import {
  loadFacebookDays,
  loadFollowerSnapshots,
  loadInstagramDays,
  loadPosts,
} from "@/lib/social/metrics";
import { summarizeBrand, type BrandSummary } from "@/lib/social/summary";
import type { DateWindow } from "@/lib/date-range";

/**
 * Per-brand summaries for the Overview, current window and the one before it.
 *
 * Six queries for any number of brands rather than six per brand: the loaders
 * take a list, and the splitting happens in memory.
 */
export async function loadBrandSummaries(
  brandIds: string[],
  range: DateWindow,
  prev?: DateWindow,
): Promise<BrandSummary[]> {
  if (brandIds.length === 0) return [];

  const [posts, igDays, fbDays, snapshots, prevPosts, prevIgDays, prevFbDays] = await Promise.all([
    loadPosts(brandIds, range.start, range.end),
    loadInstagramDays(brandIds, range.start, range.end),
    loadFacebookDays(brandIds, range.start, range.end),
    loadFollowerSnapshots(brandIds),
    prev ? loadPosts(brandIds, prev.start, prev.end) : Promise.resolve([]),
    prev ? loadInstagramDays(brandIds, prev.start, prev.end) : Promise.resolve([]),
    prev ? loadFacebookDays(brandIds, prev.start, prev.end) : Promise.resolve([]),
  ]);

  return brandIds.map((brandId) =>
    summarizeBrand({
      brandId,
      posts: posts.filter((p) => p.brandId === brandId),
      prevPosts: prevPosts.filter((p) => p.brandId === brandId),
      igDays: igDays.filter((d) => d.brandId === brandId),
      prevIgDays: prevIgDays.filter((d) => d.brandId === brandId),
      fbDays: fbDays.filter((d) => d.brandId === brandId),
      prevFbDays: prevFbDays.filter((d) => d.brandId === brandId),
      snapshot: snapshots.get(brandId) ?? null,
    }),
  );
}
