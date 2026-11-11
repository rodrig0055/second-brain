import { tool } from "ai";
import { z } from "zod";
import { and, asc, between, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { metricsDaily, socialPostDrafts } from "@/db/schema";
import { hasCapability } from "@/lib/workspaces";
import {
  DEFAULT_TIKTOK_OPTIONS,
  TIKTOK_PHOTO_CAPTION_LIMIT,
  TIKTOK_TITLE_LIMIT,
} from "@/lib/social/tiktok-rules";
import type { ToolBrand } from "../types";
import { lastSettledDay } from "./shape";

/**
 * Organic TikTok tools for one brand, reading the rows syncTiktokOrganic wrote.
 *
 * The one write, `tiktokDraftPost`, inserts a draft and stops, exactly like
 * Meta's socialDraftPost: publishing is a person pressing Publish in the Social
 * workspace, and no tool can reach TikTok's publish endpoints. Drafting is
 * limited to the team that owns the queue, because the loops engine calls
 * buildBrainTools with no team.
 */

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const LATENCY_NOTE =
  "TikTok reports every count 24-48h late (UTC). Days after `settledThrough` " +
  "are still filling in and read low; say so rather than calling them a drop.";

type Row = typeof metricsDaily.$inferSelect;

function toPost(r: Row) {
  const x = r.extra ?? {};
  const reach = num(x.reach);
  const engagement = num(x.engagement);
  return {
    date: r.date,
    mediaType: str(x.mediaType),
    permalink: str(x.permalink),
    caption: str(x.caption),
    isAd: x.isAd === true,
    views: num(x.views),
    reach,
    likes: num(x.likes),
    comments: num(x.comments),
    shares: num(x.shares),
    saves: num(x.saves),
    engagement,
    engagementRate: reach > 0 ? `${((engagement / reach) * 100).toFixed(2)}%` : null,
    avgWatchSec: typeof x.avgWatchSec === "number" ? x.avgWatchSec : null,
    fullWatchRate:
      typeof x.fullWatchRate === "number" ? `${(x.fullWatchRate * 100).toFixed(1)}%` : null,
    newFollowers: typeof x.newFollowers === "number" ? x.newFollowers : null,
  };
}

async function postRows(brandId: string, start: string, end: string) {
  return db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brandId),
        eq(metricsDaily.platform, "tiktok_organic"),
        between(metricsDaily.date, start, end),
        like(metricsDaily.dimensionKey, "tt:%"),
      ),
    )
    .orderBy(asc(metricsDaily.date));
}

export function tiktokOrganicTools(brand: ToolBrand, teamSlug?: string, connectionId?: string) {
  return {
    tiktokAccountOverview: tool({
      description:
        "This brand's TikTok account over a date range: daily video views, reach, " +
        "profile views, likes, comments, shares, bio-link clicks and follower " +
        "movement (new, lost, net), plus the follower total. Use for 'how is our " +
        "TikTok doing' and to compare periods.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD (UTC)."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD (UTC)."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const rows = await db
            .select()
            .from(metricsDaily)
            .where(
              and(
                eq(metricsDaily.brandId, brand.id),
                eq(metricsDaily.platform, "tiktok_organic"),
                between(metricsDaily.date, startDate, endDate),
                eq(metricsDaily.dimensionKey, ""),
              ),
            )
            .orderBy(asc(metricsDaily.date));
          if (rows.length === 0) {
            return {
              brand: brand.name,
              note: "No TikTok account data synced for this range. TikTok keeps 60 days of daily account data.",
            };
          }
          const days = rows.map((r) => ({ date: r.date, ...(r.extra as Record<string, unknown>) }));
          const sum = (k: string) => days.reduce((s, d) => s + num((d as Record<string, unknown>)[k]), 0);
          const withTotal = days.filter((d) => typeof (d as Record<string, unknown>).followersTotal === "number");
          return {
            brand: brand.name,
            settledThrough: lastSettledDay(),
            note: LATENCY_NOTE,
            totals: {
              videoViews: sum("videoViews"),
              profileViews: sum("profileViews"),
              likes: sum("likes"),
              comments: sum("comments"),
              shares: sum("shares"),
              bioLinkClicks: sum("bioLinkClicks"),
              newFollowers: sum("newFollowers"),
              lostFollowers: sum("lostFollowers"),
              netFollowers: sum("netFollowers"),
            },
            followersAtEnd: withTotal.length
              ? num((withTotal[withTotal.length - 1] as Record<string, unknown>).followersTotal)
              : null,
            days,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    tiktokRecentPosts: tool({
      description:
        "This brand's TikTok posts published in a date range, oldest first, with " +
        "lifetime views, reach, likes, comments, shares, saves, engagement rate " +
        "(engagement / reach), average watch time and full-watch rate. Use before " +
        "drafting, to see what was already posted.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD (UTC)."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD (UTC)."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const posts = (await postRows(brand.id, startDate, endDate)).map(toPost);
          return { brand: brand.name, settledThrough: lastSettledDay(), note: LATENCY_NOTE, count: posts.length, posts };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    tiktokTopPosts: tool({
      description:
        "Best and worst TikTok posts in a date range, ranked by engagement rate " +
        "against reach (posts under 100 reach are left out as noise). Also ranks " +
        "by full-watch rate, the retention signal TikTok's feed rewards. Use to " +
        "find the hooks and formats that work.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD (UTC)."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD (UTC)."),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ startDate, endDate, limit }) => {
        try {
          const posts = (await postRows(brand.id, startDate, endDate))
            .map(toPost)
            .filter((p) => p.reach >= 100);
          const byRate = [...posts].sort(
            (a, b) => b.engagement / b.reach - a.engagement / a.reach,
          );
          const byRetention = posts
            .filter((p) => p.fullWatchRate !== null)
            .sort((a, b) => parseFloat(b.fullWatchRate!) - parseFloat(a.fullWatchRate!));
          return {
            brand: brand.name,
            ranked: posts.length,
            byEngagementRate: { best: byRate.slice(0, limit), worst: byRate.slice(-limit).reverse() },
            byFullWatchRate: { best: byRetention.slice(0, limit), worst: byRetention.slice(-limit).reverse() },
            note: LATENCY_NOTE,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    ...(hasCapability(teamSlug, "socialDrafting")
      ? {
          tiktokDraftPost: tool({
            description:
              "Write a TikTok post into the specialist's drafts. This does NOT publish " +
              "and cannot: a person publishes it from the Social workspace. Always say " +
              "the draft is waiting and not live. TikTok takes a single video " +
              "(.mp4/.mov/.webm, 3-600 s, ideally 9:16) or 1-35 JPG/WebP images (no PNG). " +
              "Lead with the hook in the first line; 3-5 hashtags beat 30.",
            inputSchema: z.object({
              caption: z.string().min(1).max(TIKTOK_PHOTO_CAPTION_LIMIT).describe(
                "Caption. TikTok allows 2,200 characters on a video and 4,000 on a photo post.",
              ),
              mediaType: z.enum(["video", "image", "carousel"]).default("video").describe(
                "video = one video; image/carousel = a photo post (TikTok's swipeable images).",
              ),
              mediaUrls: z.array(z.string().url()).default([]).describe(
                "Public https URLs. TikTok only accepts media from our verified upload " +
                  "location, so leave this empty unless the URL came from Compose; the " +
                  "person attaches media there.",
              ),
              title: z.string().max(TIKTOK_TITLE_LIMIT).default("").describe("Photo posts only: a title up to 90 characters."),
              isAiGenerated: z.boolean().default(false).describe(
                "True when the media was AI-generated (e.g. from the image studio). TikTok labels it and the label cannot be removed.",
              ),
              plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(
                "A day (Asia/Manila) the post is meant for. A calendar marker only; nothing publishes on it.",
              ),
              rationale: z.string().default("").describe(
                "Why this post, in one or two sentences: the angle and the evidence from past posts.",
              ),
            }),
            execute: async (input) => {
              try {
                const [row] = await db
                  .insert(socialPostDrafts)
                  .values({
                    brandId: brand.id,
                    connectionId: connectionId ?? null,
                    channel: "tiktok",
                    mediaType: input.mediaType,
                    caption: input.caption,
                    mediaUrls: input.mediaUrls,
                    plannedFor: input.plannedFor ?? null,
                    rationale: input.rationale,
                    tiktokOptions: {
                      ...DEFAULT_TIKTOK_OPTIONS,
                      isAiGenerated: input.isAiGenerated,
                      title: input.title,
                    },
                    agentDrafted: true,
                    status: "draft",
                  })
                  .returning();
                return {
                  ok: true,
                  draftId: row.id,
                  status: "draft",
                  published: false,
                  message: "TikTok draft saved. It is NOT live; the specialist publishes it from the Social workspace.",
                  reviewAt: "/t/social-media/social/drafts",
                };
              } catch (err) {
                return { error: err instanceof Error ? err.message : String(err) };
              }
            },
          }),
        }
      : {}),
  };
}
