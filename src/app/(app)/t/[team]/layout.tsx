import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { requireTeam } from "@/lib/access";
import { WORKSPACE_ALIASES, workspaceFor } from "@/lib/workspaces";
import { TabIcon } from "@/components/tab-icon";
import { NavLink } from "../../nav-link";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;

  // A renamed team keeps its old links working.
  const alias = WORKSPACE_ALIASES[teamSlug];
  if (alias) redirect(`/t/${alias}`);

  const { team } = await requireTeam(teamSlug);
  const workspace = workspaceFor(team.slug);
  const base = `/t/${team.slug}`;

  // A drill-down workspace has its pages in the sidebar; a tab row here would
  // repeat them. Its own layout draws the page header.
  if (workspace.drillDown !== false) return <>{children}</>;

  return (
    <div>
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6 lg:px-10">
          <div className="flex min-h-14 items-center justify-between gap-4">
            <Link href={base} className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-900">{team.name}</span>
              <span className="block truncate text-[0.6875rem] text-zinc-500">{team.department.name}</span>
            </Link>
            {/* Server component: a lucide element, not <Icon icon={...}>, since a
                component reference cannot cross into a client component. */}
            <Button
              href={`/chat?team=${team.slug}`}
              label="New chat"
              variant="primary"
              size="sm"
              icon={<MessageSquarePlus className="size-full" aria-hidden />}
              className="shrink-0"
            />
          </div>

          {/* Tabs come from the workspace registry, so adding a surface is a
              registry entry rather than another conditional here. The pill is
              still cosmetic: each page re-asserts its own gate and 404s
              elsewhere. Channel workspaces carry their brand scope and date
              window across tabs so a click does not reset the view. */}
          <nav aria-label={`${team.name} sections`} className="-mx-1 flex gap-1 overflow-x-auto pb-2">
            {workspace.tabs.map((tab) => (
              <div key={tab.key} className="shrink-0">
                <NavLink
                  href={`${base}${tab.href}`}
                  exact={tab.exact === true || tab.href === "" || tab.key === workspace.landing}
                  label={tab.label}
                  icon={<TabIcon name={tab.icon} />}
                  preserveParams={workspace.stickyParams}
                />
              </div>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
