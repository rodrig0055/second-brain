import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { socialPostDrafts } from "@/db/schema";
import {
  loadFacebookDays,
  loadFollowerSnapshot,
  loadInstagramDays,
  loadPosts,
} from "@/lib/social/metrics";
import type { ToolBrand } from "../types";
import { organicConnectionId } from "./publish";
import { hasCapability } from "@/lib/workspaces";

/**
 * Organic social tools for one brand.
 *
 * Reads come from our synced metrics_daily rows, not live Meta calls, so a chat
 * stays fast and a rate limit never breaks a conversation.
 *
 * The one write, `socialDraftPost`, inserts a row with status `draft` and stops.
 * There is deliberately no tool that publishes: the agent cannot reach Meta's
 * write endpoints from here at all, so the worst a confused model can do is
 * queue something a human then declines. See publish.ts.
 *
 * Drafting is additionally limited to the team that owns the review queue.
 * `buildBrainTools` is called with no team by the autonomous loops engine
 * (src/lib/loops/sweep.ts, validate.ts), and a background sweep that can put
 * posts in a human's queue unprompted is not what that engine is for. Reads are
 * available everywhere; only the write is gated.
 */
export function metaOrganicTools(brand: ToolBrand, teamSlug?: string) {
  return {
    socialRecentPosts: tool({
      description:
        "Recent organic posts on this brand's Instagram and Facebook Page for a " +
        "date range, newest first. Instagram rows carry reach, views, likes, " +
        "comments, shares, saves, profile visits and engagement rate; Facebook " +
        "rows carry likes, comments, shares, clicks, the reaction breakdown and " +
        "video views, but reach is null because Meta no longer reports it for a " +
        "Page post. Use for 'how did our posts do' and to see what we have " +
        "already published before drafting something new.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        channel: z
          .enum(["instagram", "facebook", "all"])
          .default("all")
          .describe("Limit to one surface, or all."),
      }),
      execute: async ({ startDate, endDate, channel }) => {
        try {
          const posts = (await loadPosts([brand.id], startDate, endDate)).filter(
            (p) => channel === "all" || p.channel === channel,
          );
          return { brand: brand.name, count: posts.length, posts };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    socialTopPosts: tool({
      description:
        "The best and worst performing organic posts in a date range, ranked by " +
        "engagement rate against reach. Use to find what format, hook or theme " +
        "is working before writing a new post. Returns both ends because the " +
        "posts that flopped are the more useful half.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ startDate, endDate, limit }) => {
        try {
          const all = await loadPosts([brand.id], startDate, endDate);

          // Instagram: rate against reach. A post with barely any reach yet
          // carries no signal either way, and including it would let a 3-reach
          // post top the ranking on a single like.
          const byRate = all
            .filter((p) => p.reach !== null && p.reach >= 50)
            .sort(
              (a, b) =>
                b.engagement / Math.max(b.reach ?? 1, 1) -
                a.engagement / Math.max(a.reach ?? 1, 1),
            );

          // Facebook has no reach, so it is ranked on raw engagement and kept
          // in its own list. Mixing the two would compare a rate to a count.
          const byEngagement = all
            .filter((p) => p.reach === null)
            .sort((a, b) => b.engagement - a.engagement);

          return {
            brand: brand.name,
            instagram: {
              ranked: byRate.length,
              best: byRate.slice(0, limit),
              worst: byRate.slice(-limit).reverse(),
            },
            facebook: {
              note:
                "Facebook posts have no reach figure — Meta removed the metric " +
                "from the API, so no permission can bring it back. These are " +
                "ranked by total likes + comments + shares, which is a count, " +
                "not a rate, so a Facebook post cannot be compared to an " +
                "Instagram one here. `clicks` and `videoViews` ARE available " +
                "and are worth citing alongside engagement.",
              ranked: byEngagement.length,
              best: byEngagement.slice(0, limit),
              worst: byEngagement.slice(-limit).reverse(),
            },
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    socialAudienceTrend: tool({
      description:
        "Day-by-day audience and reach for a date range, per channel, plus the " +
        "current follower totals. Instagram gives daily reach and NEW followers " +
        "gained; the Facebook Page gives daily page views, post engagements and " +
        "new follows. Use for audience growth and reach trend questions. Unlike " +
        "the per-post numbers these ARE daily values and can be summed.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const [igDays, fbDays, followers] = await Promise.all([
            loadInstagramDays([brand.id], startDate, endDate),
            loadFacebookDays([brand.id], startDate, endDate),
            loadFollowerSnapshot(brand.id),
          ]);

          return {
            brand: brand.name,
            instagram: {
              days: igDays,
              // Daily reach counts each account once per day, so summing it
              // over a period double-counts anyone reached on more than one
              // day. It is a volume measure, not a unique audience.
              reachSum: igDays.reduce((a, d) => a + d.reach, 0),
              followersGained: igDays.reduce((a, d) => a + d.newFollowers, 0),
              currentFollowers: followers.instagram,
            },
            facebook: {
              note:
                "The Page has no reach or impressions on this API version. " +
                "`followersTotal` in each day is the RUNNING TOTAL on that " +
                "day, not the day's gain — do not sum it. `newFollows` is " +
                "gross, so it does not reconcile exactly with the change in " +
                "the total, which is net of unfollows Meta does not report.",
              days: fbDays,
              pageViewsSum: fbDays.reduce((a, d) => a + d.pageViews, 0),
              postEngagementsSum: fbDays.reduce(
                (a, d) => a + d.postEngagements,
                0,
              ),
              followsGained: fbDays.reduce((a, d) => a + d.newFollows, 0),
              currentFollowers: followers.facebook,
            },
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ...(hasCapability(teamSlug, "socialDrafting")
      ? {
          socialDraftPost: tool({
            description:
              "Write a social post into the specialist's drafts. This does NOT publish " +
              "anything and cannot: the draft sits in the Social workspace until a " +
              "person publishes it. Use it when the user asks you to write or plan a " +
              "post. Always say the draft is waiting for them and is not live. You " +
              "cannot schedule: Facebook scheduling and Instagram publishing are both " +
              "actions a person takes in the workspace.",
            inputSchema: z.object({
              caption: z
                .string()
                .min(1)
                .max(2200)
                .describe(
                  "The post caption. Instagram's hard limit is 2200 characters.",
                ),
              channel: z
                .enum(["instagram", "facebook", "both"])
                .default("instagram")
                .describe("Where it should go once approved."),
              mediaType: z
                .enum(["image", "video", "carousel", "text"])
                .default("image")
                .describe(
                  "text is Facebook-only. Instagram has no media-less post, so an " +
                    "Instagram draft needs at least one media URL.",
                ),
              mediaUrls: z
                .array(z.string().url())
                .default([])
                .describe(
                  "Public https image/video URLs. Meta downloads these from its own " +
                    "servers, so they must be reachable without auth. Leave empty if " +
                    "the human will attach the media.",
                ),
              linkUrl: z
                .string()
                .url()
                .optional()
                .describe("Optional link for a Facebook link post."),
              firstComment: z
                .string()
                .max(2200)
                .default("")
                .describe(
                  "Optional first comment for Instagram. Hashtags usually belong here " +
                    "rather than in the caption.",
                ),
              plannedFor: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .describe(
                  "A day (Asia/Manila) the post is meant for, as a marker on the " +
                    "calendar. Nothing publishes on this date; it is a note for the " +
                    "person.",
                ),
              tags: z
                .array(z.string())
                .default([])
                .describe("Optional labels for the specialist's own filtering."),
              rationale: z
                .string()
                .default("")
                .describe(
                  "Why this post, in one or two sentences — the angle, the evidence " +
                    "from past posts. Shown next to the draft.",
                ),
            }),
            execute: async (input) => {
              try {
                const connectionId = await organicConnectionId(brand.id);
                const [row] = await db
                  .insert(socialPostDrafts)
                  .values({
                    brandId: brand.id,
                    connectionId,
                    channel: input.channel,
                    mediaType: input.mediaType,
                    caption: input.caption,
                    mediaUrls: input.mediaUrls,
                    linkUrl: input.linkUrl ?? null,
                    firstComment: input.firstComment,
                    plannedFor: input.plannedFor ?? null,
                    tags: input.tags,
                    rationale: input.rationale,
                    agentDrafted: true,
                    status: "draft",
                  })
                  .returning();

                return {
                  ok: true,
                  draftId: row.id,
                  status: "draft",
                  published: false,
                  plannedFor: input.plannedFor ?? null,
                  message:
                    "Draft saved. It is NOT live — the specialist publishes it from the " +
                    "Social workspace.",
                  reviewAt: "/t/social-media/social/drafts",
                };
              } catch (err) {
                return {
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            },
          }),
        }
      : {}),

    socialPendingDrafts: tool({
      description:
        "List this brand's social post drafts and their status. `scheduled` " +
        "means Facebook is holding the post and will publish it itself; " +
        "`publishing` means a publish is in flight; `discarded` was decided " +
        "against. Use to answer 'what is waiting' or to check whether " +
        "something you drafted earlier went live.",
      inputSchema: z.object({
        status: z
          .enum([
            "draft",
            "scheduled",
            "publishing",
            "published",
            "failed",
            "discarded",
            "all",
          ])
          .default("all"),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ status, limit }) => {
        try {
          const rows = await db.query.socialPostDrafts.findMany({
            where:
              status === "all"
                ? eq(socialPostDrafts.brandId, brand.id)
                : and(
                    eq(socialPostDrafts.brandId, brand.id),
                    eq(socialPostDrafts.status, status),
                  ),
            orderBy: [desc(socialPostDrafts.createdAt)],
            limit,
          });
          return {
            brand: brand.name,
            drafts: rows.map((r) => ({
              id: r.id,
              status: r.status,
              channel: r.channel,
              caption: r.caption.slice(0, 200),
              permalink: r.permalink,
              error: r.error,
              createdAt: r.createdAt.toISOString(),
              publishedAt: r.publishedAt?.toISOString() ?? null,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
