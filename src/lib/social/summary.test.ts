import { test } from "node:test";
import assert from "node:assert/strict";
import { bestFacebookPost, bestInstagramPost, summarizeBrand } from "./summary";
import type { FbDay, IgDay, SocialPost } from "./metrics";

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    date: "2026-09-10",
    channel: "instagram",
    mediaType: "IMAGE",
    permalink: "",
    caption: "",
    reach: 100,
    views: 100,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    engagement: 10,
    engagementRate: null,
    clicks: null,
    profileVisits: null,
    videoViews: null,
    reactions: null,
    ...over,
  };
}
const igDay = (date: string, o: Partial<IgDay> = {}): IgDay => ({
  brandId: "b", date, reach: 0, newFollowers: 0, followersTotal: null, ...o,
});
const fbDay = (date: string, o: Partial<FbDay> = {}): FbDay => ({
  brandId: "b", date, followersTotal: 0, newFollows: 0, postEngagements: 0, pageViews: 0, ...o,
});

const EMPTY = {
  brandId: "b",
  posts: [], prevPosts: [], igDays: [], prevIgDays: [], fbDays: [], prevFbDays: [],
  snapshot: null,
};

test("Facebook reach is null, never zero", () => {
  const s = summarizeBrand({
    ...EMPTY,
    posts: [post({ channel: "facebook", reach: null, engagement: 40 })],
    fbDays: [fbDay("2026-09-10", { postEngagements: 40 })],
  });
  assert.equal(s.facebook.reach, null);
  assert.equal(s.instagram.reach, 0);
});

test("Facebook followers are the last running total, not the sum", () => {
  const s = summarizeBrand({
    ...EMPTY,
    fbDays: [
      fbDay("2026-09-08", { followersTotal: 1000 }),
      fbDay("2026-09-09", { followersTotal: 1004 }),
      fbDay("2026-09-10", { followersTotal: 1009 }),
    ],
  });
  assert.equal(s.facebook.followers, 1009);
});

test("a zero day does not erase the audience", () => {
  // The last row can be a day the metric was missing; 0 is not an audience.
  const s = summarizeBrand({
    ...EMPTY,
    fbDays: [fbDay("2026-09-09", { followersTotal: 1004 }), fbDay("2026-09-10", { followersTotal: 0 })],
  });
  assert.equal(s.facebook.followers, 1004);
});

test("followers fall back to the connection snapshot when no series exists", () => {
  const s = summarizeBrand({ ...EMPTY, snapshot: { instagram: 2086, facebook: 5000 } });
  assert.equal(s.instagram.followers, 2086);
  assert.equal(s.facebook.followers, 5000);
});

test("the Instagram series wins over the snapshot when it has one", () => {
  const s = summarizeBrand({
    ...EMPTY,
    igDays: [igDay("2026-09-10", { followersTotal: 2100 })],
    snapshot: { instagram: 2086, facebook: null },
  });
  assert.equal(s.instagram.followers, 2100);
});

test("Instagram gained is summed because it is new followers per day", () => {
  const s = summarizeBrand({
    ...EMPTY,
    igDays: [
      igDay("2026-09-09", { newFollowers: 3, reach: 500 }),
      igDay("2026-09-10", { newFollowers: 2, reach: 700 }),
    ],
  });
  assert.equal(s.instagram.followersGained, 5);
  assert.equal(s.instagram.reach, 1200);
});

test("the best Instagram post needs to clear the reach floor", () => {
  const noisy = post({ reach: 4, engagement: 1 }); // 25%, and meaningless
  const real = post({ reach: 1000, engagement: 80 }); // 8%
  assert.equal(bestInstagramPost([noisy, real]), real);
  // Nothing clears the floor: no winner rather than a made-up one.
  assert.equal(bestInstagramPost([noisy]), null);
  assert.equal(bestInstagramPost([]), null);
});

test("the best Facebook post ranks on raw engagement", () => {
  const a = post({ channel: "facebook", reach: null, engagement: 12 });
  const b = post({ channel: "facebook", reach: null, engagement: 30 });
  assert.equal(bestFacebookPost([a, b]), b);
  assert.equal(bestFacebookPost([]), null);
});

test("deltas compare like with like and report no baseline as null", () => {
  const s = summarizeBrand({
    ...EMPTY,
    igDays: [igDay("2026-09-10", { reach: 1200 })],
    prevIgDays: [igDay("2026-09-03", { reach: 1000 })],
    posts: [post(), post()],
    prevPosts: [post()],
  });
  assert.equal(s.deltas.igReach.abs, 200);
  assert.ok(Math.abs(s.deltas.igReach.pct! - 0.2) < 1e-9);
  assert.equal(s.deltas.igPosts.abs, 1);

  const fresh = summarizeBrand({ ...EMPTY, igDays: [igDay("2026-09-10", { reach: 500 })] });
  assert.equal(fresh.deltas.igReach.pct, null);
});

test("posts are counted per channel, not pooled", () => {
  const s = summarizeBrand({
    ...EMPTY,
    posts: [post(), post(), post({ channel: "facebook", reach: null })],
  });
  assert.equal(s.instagram.posts, 2);
  assert.equal(s.facebook.posts, 1);
});

test("the sparkline covers every day either channel reported", () => {
  const s = summarizeBrand({
    ...EMPTY,
    igDays: [igDay("2026-09-09", { reach: 10 })],
    fbDays: [fbDay("2026-09-10", { postEngagements: 5 })],
  });
  assert.deepEqual(s.spark, [
    { date: "2026-09-09", igReach: 10, fbEngagements: 0 },
    { date: "2026-09-10", igReach: 0, fbEngagements: 5 },
  ]);
});
