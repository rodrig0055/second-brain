import type { FbDay, IgDay, SocialPost } from "./metrics";

/**
 * One brand's fortnight, per channel.
 *
 * Instagram and Facebook never share a row. They do not measure the same thing:
 * Instagram reports reach and therefore an engagement rate, and Facebook
 * reports neither and no API version brings them back. A combined "social
 * reach" number would be Instagram's reach wearing both labels.
 *
 * Pure, so the arithmetic that decides what a specialist sees first is testable
 * without a database.
 */

export const MIN_REACH_FOR_RATE = 50;

export type Delta = { abs: number; pct: number | null };

export type ChannelSummary = {
  followers: number | null;
  followersGained: number;
  posts: number;
  engagement: number;
  /** Instagram only. Null on Facebook: absent, not zero. */
  reach: number | null;
  /** Facebook only. */
  pageViews: number | null;
  bestPost: SocialPost | null;
};

export type BrandSummary = {
  brandId: string;
  instagram: ChannelSummary;
  facebook: ChannelSummary;
  deltas: Record<string, Delta>;
  spark: { date: string; igReach: number; fbEngagements: number }[];
};

function delta(current: number, previous: number): Delta {
  return {
    abs: current - previous,
    pct: previous > 0 ? (current - previous) / previous : null,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * The post worth looking at.
 *
 * Instagram ranks by engagement rate, but only among posts that cleared a
 * reach floor: a post seen by four people with one like is a 25% rate and is
 * noise. Facebook has no rate at all, so it ranks by raw engagement.
 */
export function bestInstagramPost(posts: SocialPost[]): SocialPost | null {
  const eligible = posts.filter((p) => (p.reach ?? 0) >= MIN_REACH_FOR_RATE);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, p) =>
    p.engagement / (p.reach || 1) > best.engagement / (best.reach || 1) ? p : best,
  );
}

export function bestFacebookPost(posts: SocialPost[]): SocialPost | null {
  if (posts.length === 0) return null;
  return posts.reduce((best, p) => (p.engagement > best.engagement ? p : best));
}

export type SummaryInput = {
  brandId: string;
  posts: SocialPost[];
  prevPosts: SocialPost[];
  igDays: IgDay[];
  prevIgDays: IgDay[];
  fbDays: FbDay[];
  prevFbDays: FbDay[];
  snapshot: { instagram: number | null; facebook: number | null } | null;
};

export function summarizeBrand(input: SummaryInput): BrandSummary {
  const { brandId, posts, prevPosts, igDays, prevIgDays, fbDays, prevFbDays, snapshot } = input;

  const ig = posts.filter((p) => p.channel === "instagram");
  const fb = posts.filter((p) => p.channel === "facebook");
  const prevIg = prevPosts.filter((p) => p.channel === "instagram");
  const prevFb = prevPosts.filter((p) => p.channel === "facebook");

  const igReach = sum(igDays.map((d) => d.reach));
  const igGained = sum(igDays.map((d) => d.newFollowers));
  const igEngagement = sum(ig.map((p) => p.engagement));

  // Facebook's followersTotal is a running total, so the audience is the last
  // value in the window, never the sum. Zeros are days the metric was missing.
  const fbTotals = fbDays.map((d) => d.followersTotal).filter((n) => n > 0);
  const igTotals = igDays.map((d) => d.followersTotal).filter((n): n is number => (n ?? 0) > 0);
  const fbEngagements = sum(fbDays.map((d) => d.postEngagements));
  const fbGained = sum(fbDays.map((d) => d.newFollows));
  const fbPageViews = sum(fbDays.map((d) => d.pageViews));

  const spark = [...new Set([...igDays.map((d) => d.date), ...fbDays.map((d) => d.date)])]
    .sort()
    .map((date) => ({
      date,
      igReach: igDays.find((d) => d.date === date)?.reach ?? 0,
      fbEngagements: fbDays.find((d) => d.date === date)?.postEngagements ?? 0,
    }));

  return {
    brandId,
    instagram: {
      followers: igTotals.at(-1) ?? snapshot?.instagram ?? null,
      followersGained: igGained,
      posts: ig.length,
      engagement: igEngagement,
      reach: igReach,
      pageViews: null,
      bestPost: bestInstagramPost(ig),
    },
    facebook: {
      followers: fbTotals.at(-1) ?? snapshot?.facebook ?? null,
      followersGained: fbGained,
      posts: fb.length,
      engagement: fbEngagements,
      // Not zero: Facebook does not report post reach on this API version.
      reach: null,
      pageViews: fbPageViews,
      bestPost: bestFacebookPost(fb),
    },
    deltas: {
      igReach: delta(igReach, sum(prevIgDays.map((d) => d.reach))),
      igGained: delta(igGained, sum(prevIgDays.map((d) => d.newFollowers))),
      igEngagement: delta(igEngagement, sum(prevIg.map((p) => p.engagement))),
      igPosts: delta(ig.length, prevIg.length),
      fbGained: delta(fbGained, sum(prevFbDays.map((d) => d.newFollows))),
      fbEngagement: delta(fbEngagements, sum(prevFbDays.map((d) => d.postEngagements))),
      fbPageViews: delta(fbPageViews, sum(prevFbDays.map((d) => d.pageViews))),
      fbPosts: delta(fb.length, prevFb.length),
    },
    spark,
  };
}
