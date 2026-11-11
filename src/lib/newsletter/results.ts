/**
 * What actually got clicked, per send.
 *
 * Replaces the hand-kept "Contents with Highest Clicks (Top 5)" column. It
 * works on history the brain never touched, which is the point: SendPulse holds
 * months of sends, so the planner has performance data from day one rather than
 * after the team has used this tool for a quarter.
 *
 * Attribution has two modes. For a send the brain produced we know which block
 * emitted which href. For everything older we classify by URL shape, which
 * recovers the same vocabulary the spreadsheet uses — "Romance banner",
 * "PO logo", "Product: Grand Gesture".
 */
import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { newsletterLinkStats } from "@/db/schema";
import {
  fetchBrandCampaigns,
  getCampaignReferrals,
  type CampaignReferral,
} from "@/lib/integrations/sendpulse/client";

export type LinkStat = { href: string; kind: string; label: string; clicks: number };

/**
 * SendPulse appends its own tracking params and HTML-escapes the ampersands
 * that joined the originals, so the same destination can appear several times
 * with different tails. Strip the query entirely: the destination is what
 * attribution is about.
 */
export function normalizeLink(raw: string): string {
  const unescaped = raw.replace(/&amp;/g, "&").trim();
  try {
    const u = new URL(unescaped);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return unescaped.split("?")[0].replace(/\/+$/, "");
  }
}

const OCCASION_LABEL: Record<string, string> = {
  birthday: "Birthday banner",
  anniversary: "Anniversary banner",
  romance: "Romance banner",
  "just-because": "Just Because banner",
};

function titleise(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Classify a destination into the vocabulary the review tables already use. */
export function classifyLink(href: string, brandDomain: string): { kind: string; label: string } {
  let host = "";
  let path = "";
  try {
    const u = new URL(href);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return { kind: "other", label: href.slice(0, 60) };
  }

  if (host !== brandDomain.replace(/^www\./, "")) {
    const social = ["instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com", "youtube.com"]
      .find((s) => host.endsWith(s));
    return social
      ? { kind: "social", label: `Social: ${social.split(".")[0]}` }
      : { kind: "external", label: host };
  }

  if (path === "") return { kind: "home", label: "Logo / homepage" };

  const [seg, ...rest] = path.split("/");
  const tail = rest.join("/");
  switch (seg) {
    case "product":
      return { kind: "product", label: `Product: ${titleise(tail)}` };
    case "collection":
      return { kind: "collection", label: `Collection: ${titleise(tail)}` };
    case "search": {
      const sub = rest[rest.length - 1] ?? "";
      return {
        kind: rest[0] === "occasions" ? "occasion" : "category",
        label: OCCASION_LABEL[sub] ?? `Category: ${titleise(sub)}`,
      };
    }
    case "blog":
      return { kind: "blog", label: `Blog: ${titleise(tail)}` };
    default:
      return { kind: "page", label: `/${path}` };
  }
}

/** Fold referrals onto destinations and classify them, biggest first. */
export function attribute(
  referrals: CampaignReferral[],
  brandDomain: string,
): LinkStat[] {
  const byHref = new Map<string, number>();
  for (const r of referrals) {
    const href = normalizeLink(r.link);
    if (!href) continue;
    byHref.set(href, (byHref.get(href) ?? 0) + Number(r.count ?? 0));
  }
  return [...byHref.entries()]
    .map(([href, clicks]) => ({ href, clicks, ...classifyLink(href, brandDomain) }))
    .sort((a, b) => b.clicks - a.clicks);
}

/**
 * Pull a brand's sends in a window and store the per-link breakdown.
 * Read-only against SendPulse; idempotent on (brand, campaign).
 */
export async function ingestResults(
  brandId: string,
  domain: string,
  startDate: string,
  endDate: string,
  maxCampaigns = 200,
): Promise<{ campaigns: number; skipped: number; linksAttributed: number }> {
  const campaigns = await fetchBrandCampaigns(domain, startDate, endDate, maxCampaigns);
  let linksAttributed = 0;

  for (const c of campaigns) {
    // A campaign that is scheduled but not yet delivered reports zeros while
    // still carrying its planned volume in `all_email_qty`. Storing those as
    // results produces 0%-open rows that drag every average down and read as
    // failures rather than as sends that have not happened.
    if (c.stats.delivered === 0 && c.stats.opened === 0) continue;

    let links: LinkStat[] = [];
    try {
      links = attribute(await getCampaignReferrals(c.id), domain);
    } catch {
      // A campaign with no click data still deserves its totals row; an empty
      // link list is a fact about the send, not a reason to skip it.
      links = [];
    }
    linksAttributed += links.length;

    await db
      .insert(newsletterLinkStats)
      .values({
        brandId,
        sendpulseCampaignId: String(c.id),
        sendDate: c.date,
        subject: c.message?.subject ?? c.name ?? "",
        delivered: c.stats.delivered,
        opened: c.stats.opened,
        clicked: c.stats.clicked,
        unsubscribed: c.stats.unsubscribed,
        links,
      })
      .onConflictDoUpdate({
        target: [newsletterLinkStats.brandId, newsletterLinkStats.sendpulseCampaignId],
        set: {
          sendDate: c.date,
          subject: c.message?.subject ?? c.name ?? "",
          delivered: c.stats.delivered,
          opened: c.stats.opened,
          clicked: c.stats.clicked,
          unsubscribed: c.stats.unsubscribed,
          links,
          syncedAt: new Date(),
        },
      });
  }

  const stored = campaigns.filter((c) => c.stats.delivered > 0 || c.stats.opened > 0).length;
  return { campaigns: stored, skipped: campaigns.length - stored, linksAttributed };
}

export type ResultRow = {
  sendpulseCampaignId: string;
  sendDate: string;
  subject: string;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  links: LinkStat[];
  openRate: number;
  ctor: number;
};

function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/**
 * `since` as a date string, N days back. Lives here rather than in a component
 * because reading the clock during render is an impure call.
 */
export function sinceDaysAgo(days: number): string {
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}

export async function loadResults(brandId: string, since: string): Promise<ResultRow[]> {
  const rows = await db
    .select()
    .from(newsletterLinkStats)
    .where(and(eq(newsletterLinkStats.brandId, brandId), gte(newsletterLinkStats.sendDate, since)))
    .orderBy(desc(newsletterLinkStats.sendDate));

  return rows.map((r) => ({
    sendpulseCampaignId: r.sendpulseCampaignId,
    sendDate: r.sendDate,
    subject: r.subject,
    delivered: r.delivered,
    opened: r.opened,
    clicked: r.clicked,
    unsubscribed: r.unsubscribed,
    links: r.links ?? [],
    // Open rate is against delivered, not sent — the denominator the email team
    // quotes, and the reason `delivered` exists on metricsDaily.
    openRate: rate(r.opened, r.delivered),
    ctor: rate(r.clicked, r.opened),
  }));
}

/**
 * What has earned clicks lately, rolled up by kind and by destination. This is
 * what the planner reads: not "campaign 42 did well" but "occasion banners take
 * a third of all clicks, and these five products keep converting".
 */
export function summarise(rows: ResultRow[]) {
  const byKind = new Map<string, number>();
  const byLabel = new Map<string, { label: string; kind: string; clicks: number; sends: number }>();
  let clicks = 0;

  for (const r of rows) {
    const seen = new Set<string>();
    for (const l of r.links) {
      clicks += l.clicks;
      byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.clicks);
      const cur = byLabel.get(l.href) ?? { label: l.label, kind: l.kind, clicks: 0, sends: 0 };
      cur.clicks += l.clicks;
      if (!seen.has(l.href)) { cur.sends += 1; seen.add(l.href); }
      byLabel.set(l.href, cur);
    }
  }

  return {
    sends: rows.length,
    clicks,
    byKind: [...byKind.entries()]
      .map(([kind, n]) => ({ kind, clicks: n, share: rate(n, clicks) }))
      .sort((a, b) => b.clicks - a.clicks),
    top: [...byLabel.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 20),
  };
}
