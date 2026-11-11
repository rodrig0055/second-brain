/**
 * Gate for the Meta Ads cockpit.
 *
 * The cockpit lives under the generic `/t/[team]` route, so both the team slug
 * and the brand id arrive from the URL, and for server actions from form
 * fields. All of it is client-supplied, so every entry point re-checks both:
 * the team, because the page only exists for the ads teams, and the brand,
 * because team access and brand access are separate grants and holding one says
 * nothing about the other.
 *
 * The nav pill is a convenience. This is the control.
 */
import { notFound } from "next/navigation";

import {
  apiBrand,
  apiTeam,
  requireBrand,
  requireTeam,
  type DbBrand,
  type DbTeam,
  type DbUser,
} from "@/lib/access";
import { hasCapability, slugsWith } from "@/lib/workspaces";

/**
 * Teams that get the cockpit, read from the workspace registry.
 *
 * Meta only, deliberately. The Google Ads team has its own funnel semantics,
 * its own entity tree and no equivalent of the warm actions these rules are
 * built on — so pointing it at a Meta-shaped surface would show numbers that
 * cannot mean what their column headings say.
 */
export const ADS_TEAM_SLUGS = slugsWith("adsCockpit");

export type AdsTeamSlug = string;

export function isAdsTeam(slug: string): boolean {
  return hasCapability(slug, "adsCockpit");
}

/** Page and server-action gate. Redirects or 404s, never returns unauthorised. */
export async function requireAdsTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam }> {
  const { user, team } = await requireTeam(teamSlug);
  if (!isAdsTeam(team.slug)) notFound();
  return { user, team };
}

/**
 * The same, plus the brand whose numbers are being asked for.
 *
 * Both checks are required. Being on the Meta Ads team does not imply access to
 * every brand's spend, and having a brand grant does not imply the ads surface.
 */
export async function requireAdsBrand(
  teamSlug: string,
  brandId: string,
): Promise<{ user: DbUser; team: DbTeam; brand: DbBrand }> {
  const { user, team } = await requireAdsTeam(teamSlug);
  const { brand } = await requireBrand(brandId);
  return { user, team, brand };
}

/** API-route equivalent. Throws AccessError for accessErrorResponse to convert. */
export async function apiAdsBrand(
  teamSlug: string,
  brandId: string,
): Promise<{ user: DbUser; team: DbTeam; brand: DbBrand }> {
  const { user, team } = await apiTeam(teamSlug);
  if (!isAdsTeam(team.slug)) notFound();
  const { brand } = await apiBrand(brandId);
  return { user, team, brand };
}

export function adsPath(teamSlug: string): string {
  return `/t/${teamSlug}/ads`;
}
