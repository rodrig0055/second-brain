"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BrainCircuit,
  Building2,
  ChevronLeft,
  Home,
  Image as ImageIcon,
  LayoutTemplate,
  LogOut,
  MessageSquare,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Button } from "@astryxdesign/core/Button";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { CommandPalette, type PaletteEntry } from "@/components/command-palette";
import { TAB_ICONS } from "@/components/tab-icon";
import { ADMIN_SECTIONS } from "./admin/sections";
import type { TabIcon as TabIconName } from "@/lib/workspaces";

export type FrameTab = {
  key: string;
  href: string;
  label: string;
  /** A workspace tab icon name, or `admin:<href>` for a Settings section. */
  icon: TabIconName | `admin:${string}`;
  exact: boolean;
  secondary: boolean;
};

/** A workspace (or Settings) that takes over the sidebar while you are inside it. */
export type Drill = {
  /** `/t/<slug>` or `/admin`: every path under it drills in. */
  base: string;
  name: string;
  department: string;
  tabs: FrameTab[];
  /** Query keys carried between tabs (a channel workspace's brand and date window). */
  stickyParams?: string[];
};

export type FrameSection = { title: string; teams: { slug: string; name: string }[] };

export type FrameUser = { name: string | null; email: string; isAdmin: boolean };

const WORKSPACE_LINKS = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/chat", label: "Chat", icon: MessageSquare, exact: false },
  { href: "/insights", label: "Insights", icon: BarChart3, exact: false },
  { href: "/images", label: "Image Studio", icon: ImageIcon, exact: true },
  { href: "/images/templates", label: "Image templates", icon: LayoutTemplate, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function tabIcon(name: FrameTab["icon"]) {
  if (name.startsWith("admin:")) {
    const href = name.slice("admin:".length);
    return ADMIN_SECTIONS.find((s) => s.href === href)?.icon ?? Settings;
  }
  return TAB_ICONS[name as TabIconName] ?? TAB_ICONS.overview;
}

/**
 * The signed-in app frame: Astryx AppShell with one SideNav.
 *
 * - Root nav: Workspace links, one section per department with its teams, and Settings for admins.
 * - Inside a drill-down workspace (or Settings) the root nav steps aside for that workspace's own
 *   pages and an "All workspaces" link back, so the sidebar alone says where you are.
 * - The rail collapses to icons; below `md` AppShell moves it into a modal drawer (focus trapped,
 *   returned to the toggle) that this component closes on every navigation.
 * - The account row carries a menu with Sign out.
 */
export function AppFrame({
  user,
  sections,
  drills,
  signOutAction,
  children,
}: {
  user: FrameUser;
  sections: FrameSection[];
  drills: Drill[];
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useHotkeys([{ keys: "mod+k", allowInInputs: true, onPress: (e) => { e.preventDefault(); setPaletteOpen((o) => !o); } }]);
  const palette = usePaletteEntries(sections, drills, user.isAdmin);
  // The drawer is open only on the path it was opened from, so picking a page closes it: a drawer
  // that stays over the page you just chose reads as a click that did nothing.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileOpen = openedOn === pathname;
  const setMobileOpen = (isOpen: boolean) => setOpenedOn(isOpen ? pathname : null);

  const drill = drills.find((d) => pathname === d.base || pathname.startsWith(`${d.base}/`));

  const withSticky = (href: string) => {
    if (!drill?.stickyParams?.length) return href;
    const carry = new URLSearchParams();
    for (const key of drill.stickyParams) {
      const value = params.get(key);
      if (value) carry.set(key, value);
    }
    const qs = carry.toString();
    return qs ? `${href}?${qs}` : href;
  };

  const tabItems = (tabs: FrameTab[]) =>
    tabs.map((tab) => (
      <SideNavItem
        key={tab.key}
        label={tab.label}
        icon={tabIcon(tab.icon)}
        href={withSticky(tab.href)}
        isSelected={isActive(pathname, tab.href, tab.exact)}
      />
    ));

  const nav = drill ? (
    <>
      <SideNavSection title="Back" isHeaderHidden>
        <SideNavItem label="All workspaces" icon={ChevronLeft} href="/" size="sm" />
      </SideNavSection>
      <SideNavSection title={drill.name} subtitle={drill.department}>
        {tabItems(drill.tabs.filter((t) => !t.secondary))}
      </SideNavSection>
      {drill.tabs.some((t) => t.secondary) && (
        <>
          <Divider />
          <SideNavSection title={`${drill.name} tools`} isHeaderHidden>
            {tabItems(drill.tabs.filter((t) => t.secondary))}
          </SideNavSection>
        </>
      )}
    </>
  ) : (
    <>
      <SideNavSection title="Workspace">
        {WORKSPACE_LINKS.map((l) => (
          <SideNavItem
            key={l.href}
            label={l.label}
            icon={l.icon}
            href={l.href}
            isSelected={isActive(pathname, l.href, l.exact)}
          />
        ))}
      </SideNavSection>
      {sections.map((section) => (
        <SideNavSection key={section.title} title={section.title}>
          {section.teams.map((team) => (
            <SideNavItem
              key={team.slug}
              label={team.name}
              icon={Building2}
              href={`/t/${team.slug}`}
              isSelected={isActive(pathname, `/t/${team.slug}`, false)}
            />
          ))}
        </SideNavSection>
      ))}
      {user.isAdmin && (
        <SideNavSection title="System">
          <SideNavItem
            label="Settings"
            icon={Settings}
            href="/admin"
            isSelected={isActive(pathname, "/admin", false)}
          />
        </SideNavSection>
      )}
    </>
  );

  return (
    <AppShell
      height="auto"
      variant="section"
      mobileNav={{ isOpen: mobileOpen, onOpenChange: setMobileOpen }}
      sideNav={
        <SideNav
          collapsible
          header={
            <SideNavHeading
              heading="Second Brain"
              headingHref="/"
              icon={<NavIcon icon={<Icon icon={BrainCircuit} size="sm" />} />}
            />
          }
          topContent={
            <Button
              label="Search or jump to…"
              variant="secondary"
              size="sm"
              icon={<Icon icon={Search} />}
              width="100%"
              tooltip="⌘K / Ctrl+K"
              onClick={() => setPaletteOpen(true)}
            />
          }
          footer={
            <SideNavSection title="Account" isHeaderHidden>
              <SideNavItem
                label={user.name ?? user.email}
                icon={UserRound}
                actions={
                  <MoreMenu
                    size="sm"
                    label="Account"
                    placement="above"
                    alignment="end"
                    items={[
                      { label: user.email, isDisabled: true },
                      { type: "divider" },
                      { label: "Sign out", icon: <Icon icon={LogOut} size="sm" />, onClick: () => void signOutAction() },
                    ]}
                  />
                }
              />
            </SideNavSection>
          }
        >
          {nav}
        </SideNav>
      }
    >
      {children}
      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        entries={palette.entries}
        actions={palette.actions}
      />
    </AppShell>
  );
}

/** Every page the sidebar can reach, flattened for the command palette, plus the common actions. */
function usePaletteEntries(sections: FrameSection[], drills: Drill[], isAdmin: boolean) {
  return useMemo(() => {
    const entries: PaletteEntry[] = WORKSPACE_LINKS.map((l) => ({
      id: `page:${l.href}`,
      label: l.label,
      href: l.href,
      group: "Workspace",
    }));
    for (const section of sections) {
      for (const team of section.teams) {
        entries.push({ id: `team:${team.slug}`, label: team.name, href: `/t/${team.slug}`, group: "Workspaces", hint: section.title });
      }
    }
    for (const drill of drills) {
      for (const tab of drill.tabs) {
        if (tab.href === drill.base) continue;
        entries.push({ id: `tab:${tab.href}`, label: `${drill.name}: ${tab.label}`, href: tab.href, group: "Pages" });
      }
    }
    if (isAdmin) entries.push({ id: "page:/admin", label: "Settings", href: "/admin", group: "Workspace" });

    const actions: PaletteEntry[] = [
      { id: "action:chat", label: "New chat", href: "/chat", group: "Actions" },
      { id: "action:image", label: "Generate an image", href: "/images", group: "Actions" },
    ];
    // Compose is not a tab (every Social page has a Create post button), so it hangs off Social's overview.
    const social = drills.flatMap((d) => d.tabs).find((t) => t.href.endsWith("/social"));
    if (social) actions.push({ id: "action:post", label: "New social post", href: `${social.href}/compose`, group: "Actions" });
    return { entries, actions };
  }, [sections, drills, isAdmin]);
}
