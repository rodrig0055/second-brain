import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adAlerts, socialPostDrafts } from "@/db/schema";
import type { DbTeam, DbUser } from "@/lib/access";
import { resolveBrandScope, type BrandScope } from "@/lib/brand-scope";
import { todayIn } from "@/lib/date-range";
import {
  META_ADS_TEAM_SLUG,
  SOCIAL_TEAM_SLUG,
  isChannelWorkspace,
  workspaceFor,
  workspaceHome,
} from "@/lib/workspaces";
import { withBrandScope } from "@/lib/brand-scope";

/**
 * The one or two numbers a workspace card shows on Home.
 *
 * Each vertical registers its own function here rather than the Home page
 * knowing how to count posts or alerts. A summary that throws is dropped: a
 * slow query in one workspace must not blank the page for the others.
 */

export type HomeStat = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "alert";
};

export type HomeSummary = { stats: HomeStat[]; note?: string };

export type HomeSummaryContext = {
  user: DbUser;
  team: DbTeam;
  scope: BrandScope;
  today: string;
};

export type HomeSummaryFn = (ctx: HomeSummaryContext) => Promise<HomeSummary | null>;

/** Posts waiting on the specialist. */
const socialHomeSummary: HomeSummaryFn = async ({ scope }) => {
  const brandIds = scope.selected.map((b) => b.id);
  if (brandIds.length === 0) return null;

  const rows = await db
    .select({ status: socialPostDrafts.status, n: count() })
    .from(socialPostDrafts)
    .where(
      and(
        inArray(socialPostDrafts.brandId, brandIds),
        inArray(socialPostDrafts.status, ["draft", "failed"]),
      ),
    )
    .groupBy(socialPostDrafts.status);

  const drafts = rows.find((r) => r.status === "draft")?.n ?? 0;
  const failed = rows.find((r) => r.status === "failed")?.n ?? 0;

  const stats: HomeStat[] = [
    { label: "Drafts", value: String(drafts), tone: drafts > 0 ? "warn" : "default" },
  ];
  if (failed > 0) {
    stats.push({ label: "Failed to publish", value: String(failed), tone: "alert" });
  }
  return { stats };
};

/** What is shouting on the ad accounts. */
const adsHomeSummary: HomeSummaryFn = async ({ scope }) => {
  const connectionIds = [...scope.connections.values()]
    .flat()
    .filter((c) => scope.selected.some((b) => b.id === c.brandId))
    .map((c) => c.id);
  if (connectionIds.length === 0) return null;

  const rows = await db
    .select({ severity: adAlerts.severity, n: count() })
    .from(adAlerts)
    .where(and(inArray(adAlerts.connectionId, connectionIds), eq(adAlerts.state, "open")))
    .groupBy(adAlerts.severity);

  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const critical = rows.find((r) => r.severity === "critical")?.n ?? 0;

  const stats: HomeStat[] = [
    {
      label: "Open alerts",
      value: String(total),
      tone: critical > 0 ? "alert" : total > 0 ? "warn" : "default",
    },
  ];
  if (critical > 0) stats.push({ label: "Critical", value: String(critical), tone: "alert" });
  return { stats };
};

/** Review sections waiting on this person, and when the nearest is due. */

/** Summaries for "team" workspaces, which have no brand scope. */
const TEAM_SUMMARIES: Record<string, (ctx: { user: DbUser; today: string }) => Promise<HomeSummary | null>> = {
};

export const HOME_SUMMARIES: Record<string, HomeSummaryFn> = {
  [SOCIAL_TEAM_SLUG]: socialHomeSummary,
  [META_ADS_TEAM_SLUG]: adsHomeSummary,
};

export type HomeCard = {
  team: DbTeam;
  kind: "channel" | "team";
  href: string;
  /** Brands in the saved scope, for the dots on the card. */
  brands: { id: string; slug: string; name: string }[];
  scopeLabel: string | null;
  summary: HomeSummary | null;
};

/**
 * One card per team the user can reach. Channel workspaces resolve their saved
 * brand scope from the cookie so the link lands where the person left off.
 */
export async function loadHomeCards(user: DbUser, teams: DbTeam[]): Promise<HomeCard[]> {
  const today = todayIn();

  const results = await Promise.allSettled(
    teams.map(async (team): Promise<HomeCard> => {
      if (!isChannelWorkspace(team.slug)) {
        let summary: HomeSummary | null = null;
        try {
          summary = (await TEAM_SUMMARIES[team.slug]?.({ user, today })) ?? null;
        } catch {
          summary = null;
        }
        return {
          team,
          kind: "team",
          href: workspaceHome(team.slug),
          brands: [],
          scopeLabel: null,
          summary,
        };
      }

      const scope = await resolveBrandScope({
        user,
        teamSlug: team.slug,
        searchParams: {},
      });

      let summary: HomeSummary | null = null;
      try {
        summary = (await HOME_SUMMARIES[team.slug]?.({ user, team, scope, today })) ?? null;
      } catch {
        // A card without numbers still gets you into the workspace.
        summary = null;
      }

      return {
        team,
        kind: "channel",
        href: withBrandScope(workspaceHome(team.slug), scope),
        brands: scope.selected.map((b) => ({ id: b.id, slug: b.slug, name: b.name })),
        scopeLabel:
          scope.all.length === 0
            ? "No account connected"
            : scope.isAll && scope.all.length > 1
              ? `All ${scope.all.length} brands`
              : scope.selected.length === 1
                ? scope.selected[0].name
                : `${scope.selected.length} brands`,
        summary,
      };
    }),
  );

  return results.flatMap((r, i) =>
    r.status === "fulfilled"
      ? [r.value]
      : [
          {
            team: teams[i],
            kind: workspaceFor(teams[i].slug).kind,
            href: `/t/${teams[i].slug}`,
            brands: [],
            scopeLabel: null,
            summary: null,
          } satisfies HomeCard,
        ],
  );
}
