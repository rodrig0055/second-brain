/**
 * What a team's surface is made of.
 *
 * `team.slug` had become a de-facto foreign key: the nav pills, the tool
 * scoping, the prompt focus, the drafting gate and four one-off capability
 * checks each hardcoded their own list of slugs in a different file. Renaming a
 * team silently broke about fourteen places, and adding a tab meant editing a
 * layout. This is the one place that knows.
 *
 * Two shapes of team:
 *   "team"    — the generic surface: Overview, Tasks, Outputs, Dashboards.
 *   "channel" — a specialist workspace (Social, Meta Ads). It owns its own tabs
 *               and a brand scope, because the person working it runs several
 *               brands at once rather than one at a time.
 *
 * Pure data: no db, no React, `import type` only, so the chat route, the client
 * nav and a one-off script can all read it.
 */

import type { integrationPlatform } from "@/db/schema";

export type IntegrationPlatform = (typeof integrationPlatform.enumValues)[number];

export const SOCIAL_TEAM_SLUG = "social-media";
export const META_ADS_TEAM_SLUG = "meta-ads";
export const NEWSLETTER_TEAM_SLUG = "newsletter";
export const SEO_TEAM_SLUG = "seo";
export const COMMERCIAL_TEAM_SLUG = "commercial";
export const GOOGLE_ADS_TEAM_SLUG = "google-ads";
export const PARTNERSHIPS_TEAM_SLUG = "partnerships";

/**
 * Icons travel as names, not components: a function cannot cross the server /
 * client boundary, and this module is imported by both.
 */
export type TabIcon =
  | "overview"
  | "tasks"
  | "outputs"
  | "dashboards"
  | "ads"
  | "performance"
  | "creatives"
  | "ideate"
  | "alerts"
  | "social"
  | "posts"
  | "compose"
  | "calendar"
  | "drafts"
  | "campaigns"
  | "leads"
  | "changes"
  | "connections"
  | "scorecard"
  | "customers"
  | "meetings"
  | "inputs"
  | "partners"
  | "sales"
  | "ai-search"
  | "prompts"
  | "roadmap";

export type WorkspaceTab = {
  key: string;
  label: string;
  /** Appended to `/t/<slug>`. "" is the overview. */
  href: string;
  icon: TabIcon;
  /** Highlight only on this exact path, for a tab whose sub-pages are other tabs. */
  exact?: boolean;
};

/**
 * One-off behaviours that used to be a slug literal somewhere. Each name is the
 * question the calling site actually asks.
 */
export type WorkspaceCapabilities = {
  /** Owns the ads cockpit (was ADS_TEAM_SLUGS). */
  adsCockpit?: boolean;
  /** May queue a social post from chat (was DRAFTING_TEAMS). */
  socialDrafting?: boolean;
  /** Chat answers an exact ad-id question without an LLM (was the api/chat literal). */
  metaExactLookup?: boolean;
  /** Gets the Search Console + Ahrefs tools. */
  gscTools?: boolean;
  /** Gets the storefront catalog/sitemap tools. */
  storefrontTools?: boolean;
  /** Task runs attach the SEO tools. */
  seoTools?: boolean;
  /** Gets the Merchant Center catalog + title proposal tools. */
  merchantCenterTools?: boolean;
  /** Gets the CMS tools over MCP: reads, and changes behind an Apply card. */
  cmsTools?: boolean;
};

export type Workspace = {
  slug: string;
  kind: "channel" | "team";
  tabs: WorkspaceTab[];
  /**
   * Platforms whose brain tools a chat or task in this team may use. Undefined
   * means unscoped: every connected platform, which is also what a call with no
   * team gets.
   */
  platforms?: IntegrationPlatform[];
  /** Connections that decide which brands belong to this channel workspace. */
  scopePlatforms?: IntegrationPlatform[];
  /** The team's lens, injected into the system prompt. */
  focus?: string;
  /** Tab a Home card deep-links to. Defaults to the overview. */
  landing?: string;
  /** Query keys the tab row carries between pages. */
  stickyParams?: string[];
  /**
   * Whether the sidebar drills into this workspace: inside it, the app nav is
   * replaced by the workspace's own pages and a way back, and the team layout
   * drops its tab row, so one place shows where you are instead of two. On for
   * every workspace unless set to false.
   */
  drillDown?: boolean;
  /**
   * Tabs that open a separate kind of work (tasks, outputs) rather than a view
   * of the channel. The drilled sidebar lists them under a divider.
   */
  secondaryTabs?: string[];
  /** This team only ever works one brand (custom-song is Bloomly PH). */
  lockedBrandSlug?: string;
  capabilities: WorkspaceCapabilities;
};

export const GENERIC_TABS: WorkspaceTab[] = [
  { key: "overview", label: "Overview", href: "", icon: "overview" },
  { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
  { key: "outputs", label: "Outputs", href: "/runs", icon: "outputs" },
  { key: "dashboards", label: "Dashboards", href: "/dashboards", icon: "dashboards" },
];

/** What a channel workspace carries from tab to tab so the scope survives a click. */
const CHANNEL_STICKY = ["brands", "range", "from", "to", "compare"];

export const WORKSPACES: Record<string, Workspace> = {
  [SOCIAL_TEAM_SLUG]: {
    slug: SOCIAL_TEAM_SLUG,
    kind: "channel",
    // Instagram and Facebook for several brands at once: the work is compose,
    // look at what happened, plan the next one. Not an approval inbox.
    tabs: [
      // Compose is not a tab: every page has a Create post button that opens
      // it in a side panel, and /social/compose still works as a full page.
      { key: "overview", label: "Overview", href: "/social", icon: "overview" },
      { key: "posts", label: "Posts", href: "/social/posts", icon: "posts" },
      { key: "calendar", label: "Calendar", href: "/social/calendar", icon: "calendar" },
      { key: "drafts", label: "Drafts", href: "/social/drafts", icon: "drafts" },
      { key: "connections", label: "Connections", href: "/social/connections", icon: "connections" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
      { key: "outputs", label: "Outputs", href: "/runs", icon: "outputs" },
    ],
    drillDown: true,
    secondaryTabs: ["tasks", "outputs"],
    platforms: ["meta_organic", "meta", "tiktok_organic"],
    scopePlatforms: ["meta_organic"],
    focus:
      "You are assisting the **Social Media** team. Interpret unqualified performance questions as **organic social** performance on Instagram and the Facebook Page, and call the `social*` tools first.\n" +
      "Facebook posts have **no reach and no impressions** on this API version and never will: rank Facebook by engagement counts, clicks and video views, never by a rate, and never report 0 reach for a Facebook post — it is absent, not zero.\n" +
      "Instagram engagement rate is engagement/reach and is only meaningful above ~50 reach. Instagram's daily `follower_count` is NEW followers that day, not the total.\n" +
      "TikTok: call the `tiktok*` tools. Its counts arrive 24-48h late (UTC), so the last two days always read low; engagement rate there is engagement/reach, and full-watch rate is the retention signal its feed rewards.\n" +
      "Drafting rules: caption up to 2200 characters with the hook in the first 125, at most 30 hashtags (5-15 reads better, or move them to the first comment), Instagram images are JPEG at 4:5 or 1:1, video posts publish as Reels, carousels are 2-10 items.\n" +
      "You draft; the specialist reviews and publishes. Planned dates are Asia/Manila days.",
    landing: "overview",
    stickyParams: CHANNEL_STICKY,
    capabilities: { socialDrafting: true },
  },

  [META_ADS_TEAM_SLUG]: {
    slug: META_ADS_TEAM_SLUG,
    kind: "channel",
    tabs: [
      { key: "overview", label: "Overview", href: "/ads", icon: "overview" },
      { key: "performance", label: "Performance", href: "/ads/performance", icon: "performance" },
      { key: "creatives", label: "Creatives", href: "/ads/creatives", icon: "creatives" },
      { key: "ideate", label: "Ideate", href: "/ads/ideate", icon: "ideate" },
      { key: "alerts", label: "Alerts", href: "/ads/alerts", icon: "alerts" },
      { key: "changes", label: "Changes", href: "/ads/changes", icon: "changes" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
      { key: "outputs", label: "Outputs", href: "/runs", icon: "outputs" },
    ],
    platforms: ["meta", "meta_organic"],
    scopePlatforms: ["meta"],
    focus:
      'You are assisting the **Meta Ads** team. Interpret "performance", "results", and any unqualified metric question as **Meta (Facebook/Instagram) advertising** performance — spend, ROAS, CPA, CTR, impressions, conversions, and campaign/ad breakdowns — and call the `meta*` tools first. Do NOT answer with website sessions, organic search, or store-wide revenue unless the user explicitly asks for those.',
    secondaryTabs: ["tasks", "outputs"],
    landing: "overview",
    stickyParams: CHANNEL_STICKY,
    capabilities: { adsCockpit: true, metaExactLookup: true },
  },

  [NEWSLETTER_TEAM_SLUG]: {
    slug: NEWSLETTER_TEAM_SLUG,
    kind: "team",
    tabs: [
      ...GENERIC_TABS,
      { key: "campaigns", label: "Campaigns", href: "/newsletter", icon: "campaigns" },
    ],
    platforms: ["sendpulse"],
    focus:
      "You are assisting the **Newsletter / Email** team. Interpret unqualified performance questions as **email** performance — emails sent, delivered, opens, open rate, clicks/CTR, and unsubscribes — and call the `sendpulse*` tools first.",
    capabilities: {},
  },

  [SEO_TEAM_SLUG]: {
    slug: SEO_TEAM_SLUG,
    kind: "team",
    tabs: [
      ...GENERIC_TABS,
      // AI search visibility: the buyer prompts tracked across ChatGPT,
      // Gemini and Claude, and the 90-day fix cycles.
      { key: "ai-search", label: "AI search", href: "/ai-search", icon: "ai-search", exact: true },
      { key: "ai-prompts", label: "AI prompts", href: "/ai-search/prompts", icon: "prompts" },
      { key: "ai-roadmap", label: "AI roadmap", href: "/ai-search/roadmap", icon: "roadmap" },
    ],
    platforms: ["ga4"],
    focus:
      "You are assisting the **SEO** team. Interpret unqualified performance questions as **organic search** performance — clicks, impressions, average position, CTR, and top pages/queries — and call the GSC tools (`queryGsc` / `compareGscPeriods`) first.",
    capabilities: { gscTools: true, storefrontTools: true, seoTools: true, merchantCenterTools: true },
  },

  [COMMERCIAL_TEAM_SLUG]: {
    slug: COMMERCIAL_TEAM_SLUG,
    kind: "team",
    tabs: GENERIC_TABS,
    platforms: ["shopify", "ga4"],
    focus:
      "You are assisting the **Commercial** team. Focus on sales, orders, and store revenue (Shopify) and commercial outcomes.",
    capabilities: { storefrontTools: true, merchantCenterTools: true, cmsTools: true },
  },

  // Deliberately has no `platforms`: its seeded templates call both the meta* and googleAds* tools, and scoping it to one
  // platform would break them.
  [GOOGLE_ADS_TEAM_SLUG]: {
    slug: GOOGLE_ADS_TEAM_SLUG,
    kind: "team",
    tabs: GENERIC_TABS,
    capabilities: { merchantCenterTools: true },
  },

  // The partner tracker: outreach with its follow-up ladder, and each
  // live partner's sales from its voucher codes.
  [PARTNERSHIPS_TEAM_SLUG]: {
    slug: PARTNERSHIPS_TEAM_SLUG,
    kind: "team",
    tabs: [
      { key: "outreach", label: "Partners", href: "/partners", icon: "partners" },
      { key: "sales", label: "Sales", href: "/partners/sales", icon: "sales" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
      { key: "outputs", label: "Outputs", href: "/runs", icon: "outputs" },
    ],
    secondaryTabs: ["tasks", "outputs"],
    landing: "outreach",
    focus:
      "You are assisting the **Partnerships** team: perks platforms, schools and companies that share a brand discount code with their members. " +
      "Partner codes are created only after the partner confirms; a missing code is expected, not a bug.",
    capabilities: {},
  },
};

const GENERIC_WORKSPACE: Omit<Workspace, "slug"> = {
  kind: "team",
  tabs: GENERIC_TABS,
  capabilities: {},
};

/** Old slug -> current slug, so a bookmark survives a rename. */
export const WORKSPACE_ALIASES: Record<string, string> = {
  "paid-media": GOOGLE_ADS_TEAM_SLUG,
};

/** A team not in the registry still works: it gets the generic surface. */
export function workspaceFor(slug: string): Workspace {
  return WORKSPACES[slug] ?? { slug, ...GENERIC_WORKSPACE };
}

export function isChannelWorkspace(slug: string): boolean {
  return workspaceFor(slug).kind === "channel";
}

export function workspaceTabs(slug: string): WorkspaceTab[] {
  return workspaceFor(slug).tabs;
}

/**
 * Which platforms this team's tools may read. Undefined (unmapped team, or no
 * team at all, as the autonomous loops engine calls it) means every connected
 * platform.
 */
export function workspacePlatforms(slug?: string): IntegrationPlatform[] | undefined {
  if (!slug) return undefined;
  return WORKSPACES[slug]?.platforms;
}

export function workspaceFocus(slug?: string): string | undefined {
  if (!slug) return undefined;
  return WORKSPACES[slug]?.focus;
}

/**
 * Capability check. A call with no team is deliberately true for the tool
 * capabilities that used to read `!teamSlug || teamSlug === "seo"`: a background
 * pass with no team keeps seeing everything it saw before.
 */
export function hasCapability(
  slug: string | undefined,
  capability: keyof WorkspaceCapabilities,
): boolean {
  if (!slug) return false;
  return workspaceFor(slug).capabilities[capability] === true;
}

/** Every workspace declaring a capability, e.g. the teams that own the cockpit. */
export function workspacesWith(capability: keyof WorkspaceCapabilities): Workspace[] {
  return Object.values(WORKSPACES).filter((w) => w.capabilities[capability] === true);
}

export function slugsWith(capability: keyof WorkspaceCapabilities): string[] {
  return workspacesWith(capability).map((w) => w.slug);
}

export function tabFor(slug: string, tabKey: string): WorkspaceTab | undefined {
  return workspaceTabs(slug).find((t) => t.key === tabKey);
}

/** `/t/<slug><tab.href>` plus an optional query. */
export function workspaceHref(
  slug: string,
  tabKey?: string,
  query?: Record<string, string | undefined>,
): string {
  const tab = tabKey ? tabFor(slug, tabKey) : undefined;
  const base = `/t/${slug}${tab?.href ?? ""}`;
  if (!query) return base;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Where a Home card for this team points. */
export function workspaceHome(slug: string, query?: Record<string, string | undefined>): string {
  const ws = workspaceFor(slug);
  return workspaceHref(slug, ws.landing, query);
}

export function channelWorkspaces(): Workspace[] {
  return Object.values(WORKSPACES).filter((w) => w.kind === "channel");
}
