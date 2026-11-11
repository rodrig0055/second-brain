/**
 * Gate for the AI search tracker, which lives in the SEO workspace.
 *
 * The slug arrives from the URL (and, for server actions, a form field), so it
 * is client supplied: authorisation goes through `requireTeam`, then the slug
 * is re-checked here. The nav tab is a convenience, never the control.
 */
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { brands } from "@/db/schema";
import { requireTeam, type DbBrand, type DbTeam, type DbUser } from "@/lib/access";
import { AI_SEARCH_BRAND_SLUG, AI_SEARCH_TEAM_SLUG } from "./model";

export async function aiSearchBrand(): Promise<DbBrand | null> {
  return (await db.query.brands.findFirst({ where: eq(brands.slug, AI_SEARCH_BRAND_SLUG) })) ?? null;
}

export async function requireAiSearchTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam; brand: DbBrand }> {
  const { user, team } = await requireTeam(teamSlug);
  if (team.slug !== AI_SEARCH_TEAM_SLUG) notFound();
  const brand = await aiSearchBrand();
  if (!brand) notFound();
  return { user, team, brand };
}

export const aiSearchPath = (sub = ""): string => `/t/${AI_SEARCH_TEAM_SLUG}/ai-search${sub}`;
