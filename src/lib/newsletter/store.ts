/**
 * Read model for newsletter campaigns.
 *
 * Kept apart from the server actions so pages can load without pulling the
 * mutation surface into their import graph.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { brands, newsletterCampaigns, newsletterSlots, users } from "@/db/schema";
import type { Block } from "./campaign";
import { matchThemes, silentDay, weekdayOf, type FrameworkDay } from "./framework";

export type CampaignRow = {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  brandDomain: string;
  sendDate: string;
  status: string;
  subject: string;
  preheader: string;
  blocks: Block[];
  heroAssetUrl: string;
  derivedImages: { key: string; url: string; bytes: number }[];
  validation: { errors: number; warnings: number; checkedAt: string } | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
};

const SELECT = {
  id: newsletterCampaigns.id,
  brandId: newsletterCampaigns.brandId,
  brandName: brands.name,
  brandSlug: brands.slug,
  brandDomain: brands.domain,
  sendDate: newsletterCampaigns.sendDate,
  status: newsletterCampaigns.status,
  subject: newsletterCampaigns.subject,
  preheader: newsletterCampaigns.preheader,
  blocks: newsletterCampaigns.blocks,
  heroAssetUrl: newsletterCampaigns.heroAssetUrl,
  derivedImages: newsletterCampaigns.derivedImages,
  validation: newsletterCampaigns.validation,
  approvedBy: users.name,
  approvedAt: newsletterCampaigns.approvedAt,
  updatedAt: newsletterCampaigns.updatedAt,
};

function shape(r: Record<string, unknown>): CampaignRow {
  return {
    ...(r as unknown as CampaignRow),
    blocks: Array.isArray(r.blocks) ? (r.blocks as Block[]) : [],
    derivedImages: Array.isArray(r.derivedImages)
      ? (r.derivedImages as CampaignRow["derivedImages"])
      : [],
  };
}

export async function listCampaigns(teamId: string): Promise<CampaignRow[]> {
  const rows = await db
    .select(SELECT)
    .from(newsletterCampaigns)
    .innerJoin(brands, eq(brands.id, newsletterCampaigns.brandId))
    .leftJoin(users, eq(users.id, newsletterCampaigns.approvedById))
    .where(eq(newsletterCampaigns.teamId, teamId))
    .orderBy(desc(newsletterCampaigns.sendDate), desc(newsletterCampaigns.updatedAt));
  return rows.map((r) => shape(r as Record<string, unknown>));
}

export async function loadCampaign(
  id: string,
  teamId: string,
): Promise<CampaignRow | null> {
  const [row] = await db
    .select(SELECT)
    .from(newsletterCampaigns)
    .innerJoin(brands, eq(brands.id, newsletterCampaigns.brandId))
    .leftJoin(users, eq(users.id, newsletterCampaigns.approvedById))
    // The team is part of the predicate, not checked after the read: a campaign
    // belonging to another team must not be loadable by guessing its id.
    .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.teamId, teamId)))
    .limit(1);
  return row ? shape(row as Record<string, unknown>) : null;
}

/** Brands this team can plan newsletters for. */
export async function newsletterBrands(brandIds?: string[]) {
  return brandIds?.length
    ? db.select().from(brands).where(inArray(brands.id, brandIds))
    : db.select().from(brands);
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  needs_art: "Needs hero art",
  ready: "Approved",
  handed_off: "In SendPulse",
  sent: "Sent",
  archived: "Archived",
};

/**
 * What the content framework says for one brand on one date.
 *
 * The framework is the authority on WHICH blocks a send pushes; the template is
 * the authority on the shape. A weekday the brand does not send on returns a
 * silent day rather than throwing, so a marketer can still build an off-cadence
 * campaign and simply gets the template's own defaults.
 */
export async function frameworkFor(brandId: string, sendDate: string): Promise<FrameworkDay> {
  const weekday = weekdayOf(sendDate);
  const [row] = await db
    .select()
    .from(newsletterSlots)
    .where(and(
      eq(newsletterSlots.brandId, brandId),
      eq(newsletterSlots.weekday, weekday),
      eq(newsletterSlots.isActive, true),
    ))
    .limit(1);

  if (!row) return silentDay(weekday);
  return {
    weekday,
    themes: row.themes,
    matches: matchThemes(row.themes),
    voucher: row.voucher,
    sends: true,
  };
}
