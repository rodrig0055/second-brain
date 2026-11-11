/**
 * Gate for the Newsletter team's campaign surface.
 *
 * Campaign pages live under the generic `/t/[team]` route, so the team slug
 * arrives from the URL and, for server actions, from a form field. Both are
 * client-supplied, so authorisation always goes through `requireTeam` and the
 * slug is re-checked here. The nav pill is a convenience, never the control.
 */
import { notFound } from "next/navigation";

import { requireTeam, type DbTeam, type DbUser } from "@/lib/access";

export { NEWSLETTER_TEAM_SLUG } from "@/lib/workspaces";
import { NEWSLETTER_TEAM_SLUG } from "@/lib/workspaces";

export async function requireNewsletterTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam }> {
  const { user, team } = await requireTeam(teamSlug);
  if (team.slug !== NEWSLETTER_TEAM_SLUG) notFound();
  return { user, team };
}

export function campaignsPath(): string {
  return `/t/${NEWSLETTER_TEAM_SLUG}/newsletter`;
}

export function campaignPath(id: string): string {
  return `${campaignsPath()}/${id}`;
}
