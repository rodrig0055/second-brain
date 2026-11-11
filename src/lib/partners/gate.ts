/**
 * Gate for the Partnerships team's tracker.
 *
 * The pages live under the generic `/t/[team]` route, so the slug arrives from
 * the URL (and, for server actions, from a form field). Both are client
 * supplied, so authorisation always goes through `requireTeam` and the slug is
 * then re-checked here: the nav tab is a convenience, never the control.
 */
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { brands } from "@/db/schema";
import { requireTeam, type DbBrand, type DbTeam, type DbUser } from "@/lib/access";
import { PARTNERS_BRAND_SLUG, PARTNERSHIPS_TEAM_SLUG } from "./model";

export async function requirePartnershipsTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam; brand: DbBrand }> {
  const { user, team } = await requireTeam(teamSlug);
  if (team.slug !== PARTNERSHIPS_TEAM_SLUG) notFound();

  const brand = await db.query.brands.findFirst({ where: eq(brands.slug, PARTNERS_BRAND_SLUG) });
  if (!brand) notFound();

  return { user, team, brand };
}

export function partnersPath(): string {
  return `/t/${PARTNERSHIPS_TEAM_SLUG}/partners`;
}

export function partnerPath(id: string): string {
  return `${partnersPath()}/${id}`;
}

export function salesPath(): string {
  return `${partnersPath()}/sales`;
}
