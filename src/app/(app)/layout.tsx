import { requireUser, getUserTeams, getDepartments } from "@/lib/access";
import { signOut } from "@/auth";
import { workspaceFor } from "@/lib/workspaces";
import { ADMIN_SECTIONS } from "./admin/sections";
import { AppFrame, type Drill, type FrameSection } from "./app-frame";

/**
 * Every signed-in page. The server half: who you are, which teams you can open, and the nav data
 * for them. The frame itself (AppShell + SideNav, drill-down, mobile drawer) is <AppFrame>, a
 * client component, so it only receives plain data: icon names, not icon components.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [teams, departments] = await Promise.all([getUserTeams(user), getDepartments()]);

  const sections: FrameSection[] = departments
    .map((dept) => ({
      title: dept.name,
      teams: teams
        .filter((team) => team.departmentId === dept.id)
        .map((team) => ({ slug: team.slug, name: team.name })),
    }))
    .filter((section) => section.teams.length > 0);

  // Workspaces that take over the sidebar while you are inside them.
  const drills: Drill[] = teams.flatMap((team) => {
    const ws = workspaceFor(team.slug);
    if (ws.drillDown === false) return [];
    const base = `/t/${team.slug}`;
    return [
      {
        base,
        name: team.name,
        department: departments.find((d) => d.id === team.departmentId)?.name ?? "",
        stickyParams: ws.stickyParams,
        tabs: ws.tabs.map((tab) => ({
          key: tab.key,
          href: `${base}${tab.href}`,
          label: tab.label,
          icon: tab.icon,
          exact: tab.exact === true || tab.href === "" || tab.key === ws.landing,
          secondary: ws.secondaryTabs?.includes(tab.key) ?? false,
        })),
      },
    ];
  });

  // Settings drills down the same way: its sections replace the app nav.
  if (user.role === "admin") {
    drills.push({
      base: "/admin",
      name: "Settings",
      department: "Administration",
      tabs: ADMIN_SECTIONS.map((section) => ({
        key: section.href,
        href: section.href,
        label: section.label,
        icon: `admin:${section.href}` as const,
        exact: section.exact ?? false,
        secondary: section.group === "system",
      })),
    });
  }

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <AppFrame
      user={{ name: user.name ?? null, email: user.email, isAdmin: user.role === "admin" }}
      sections={sections}
      drills={drills}
      signOutAction={signOutAction}
    >
      {children}
    </AppFrame>
  );
}
