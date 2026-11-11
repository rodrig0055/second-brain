import { requireSocialTeam } from "@/lib/social/access";
import { SocialHeader } from "./social-header";

/**
 * The Social workspace shell.
 *
 * Its pages are in the sidebar (the workspace drills down), so this draws only
 * the header and hosts `sheet`: the slot where Create post opens over whatever
 * page you were on. The gate here is a convenience; every page re-asserts it.
 */
export default async function SocialLayout({
  children,
  sheet,
  params,
}: {
  children: React.ReactNode;
  sheet: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const { team } = await requireSocialTeam(teamSlug);

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <SocialHeader teamSlug={team.slug} />
      {children}
      {sheet}
    </div>
  );
}
