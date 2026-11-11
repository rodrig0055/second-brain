import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections, socialPostDrafts } from "@/db/schema";
import { getUserBrands, requireTeam, type DbBrand, type DbTeam, type DbUser } from "@/lib/access";
import { SOCIAL_TEAM_SLUG } from "@/lib/workspaces";

export { SOCIAL_TEAM_SLUG };

/**
 * Gate for the Social workspace.
 *
 * The team slug arrives from the URL, and from a form field for server actions,
 * so it is client-supplied and re-checked on every entry point. Team access and
 * brand access are separate grants: holding one says nothing about the other,
 * so both are checked, every time.
 *
 * The nav pill is a convenience. This is the control.
 */

export type SocialBrand = DbBrand & {
  connection: {
    id: string;
    status: string;
    igUserId: string;
    igUsername: string;
    pageName: string;
  } | null;
};

/**
 * Brands this user can work, with their Meta connection attached.
 *
 * A brand whose connection is in `error` is still listed. Hiding it would leave
 * someone wondering where their brand went; showing it with the problem named
 * is the difference between a bug and a to-do.
 */
async function socialBrands(user: DbUser): Promise<{ brands: SocialBrand[]; unconnected: DbBrand[] }> {
  const accessible = await getUserBrands(user);
  if (accessible.length === 0) return { brands: [], unconnected: [] };

  const conns = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        inArray(
          integrationConnections.brandId,
          accessible.map((b) => b.id),
        ),
        eq(integrationConnections.platform, "meta_organic"),
      ),
    );
  const byBrand = new Map(conns.map((c) => [c.brandId, c]));

  const brands: SocialBrand[] = [];
  const unconnected: DbBrand[] = [];
  for (const brand of accessible) {
    const conn = byBrand.get(brand.id);
    if (!conn || conn.status === "disconnected") {
      unconnected.push(brand);
      continue;
    }
    brands.push({
      ...brand,
      connection: {
        id: conn.id,
        status: conn.status,
        igUserId: String(conn.config.igUserId ?? ""),
        igUsername: String(conn.config.igUsername ?? ""),
        pageName: String(conn.config.pageName ?? ""),
      },
    });
  }
  return { brands, unconnected };
}

export async function requireSocialTeam(teamSlug: string): Promise<{
  user: DbUser;
  team: DbTeam;
  brands: SocialBrand[];
  unconnected: DbBrand[];
}> {
  const { user, team } = await requireTeam(teamSlug);
  if (team.slug !== SOCIAL_TEAM_SLUG) notFound();
  const { brands, unconnected } = await socialBrands(user);
  return { user, team, brands, unconnected };
}

/** Narrow to specific brands. Anything not granted 404s rather than silently dropping. */
export async function requireSocialBrands(
  teamSlug: string,
  brandIds: string[],
): Promise<{ user: DbUser; team: DbTeam; brands: SocialBrand[] }> {
  const { user, team, brands } = await requireSocialTeam(teamSlug);
  const wanted = new Set(brandIds);
  const hit = brands.filter((b) => wanted.has(b.id));
  if (hit.length !== wanted.size) notFound();
  return { user, team, brands: hit };
}

/**
 * A draft, by id.
 *
 * The brand comes off the row rather than from the form: a form field naming a
 * brand the user does happen to hold would otherwise authorise editing another
 * brand's draft.
 */
export async function requireSocialDraft(
  teamSlug: string,
  draftId: string,
): Promise<{
  user: DbUser;
  team: DbTeam;
  brand: SocialBrand;
  draft: typeof socialPostDrafts.$inferSelect;
}> {
  const { user, team, brands } = await requireSocialTeam(teamSlug);
  const draft = await db.query.socialPostDrafts.findFirst({
    where: eq(socialPostDrafts.id, draftId),
  });
  if (!draft) notFound();
  const brand = brands.find((b) => b.id === draft.brandId);
  if (!brand) notFound();
  return { user, team, brand, draft };
}

export type SocialTab = "" | "posts" | "compose" | "calendar" | "drafts" | "connections";

export function socialPath(tab: SocialTab = "", query?: Record<string, string | undefined>): string {
  const base = `/t/${SOCIAL_TEAM_SLUG}/social${tab ? `/${tab}` : ""}`;
  if (!query) return base;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}
