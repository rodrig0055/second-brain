/**
 * Hand a finished campaign to SendPulse.
 *
 * The brain stores the email as a template and stops. It does not create a
 * campaign and it does not send: a person opens SendPulse, picks the template,
 * chooses the list and presses send. That boundary is deliberate — everything
 * up to here is reversible, and sending is not.
 *
 * Images need no upload. The renderer already put the derivatives on public
 * blob storage, so SendPulse fetches them by URL like any other remote image.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { newsletterCampaigns } from "@/db/schema";
import { createTemplate } from "@/lib/integrations/sendpulse/client";
import { renderCampaign } from "./render";
import type { CampaignRow } from "./store";

/** A name a human can recognise in a list of thousands. */
export function templateName(row: CampaignRow): string {
  const subject = row.subject.replace(/\s+/g, " ").trim().slice(0, 48);
  return `${row.brandName} ${row.sendDate}${subject ? ` — ${subject}` : ""}`;
}

export type HandoffResult =
  | { ok: true; templateId: number; name: string }
  | { ok: false; reason: string; errors?: number };

export async function handOff(row: CampaignRow): Promise<HandoffResult> {
  if (row.status !== "ready") {
    return { ok: false, reason: "Campaign has not been approved yet." };
  }
  if (!row.heroAssetUrl) {
    return { ok: false, reason: "No hero image set." };
  }

  // Re-render rather than trusting anything cached. Between approval and this
  // click the catalog can change, and the template is the artefact that
  // actually gets mailed.
  const result = await renderCampaign({
    campaignId: row.id,
    brandId: row.brandId,
    domain: row.brandDomain,
    campaign: {
      brand: row.brandName,
      domain: row.brandDomain,
      date: row.sendDate,
      subject: row.subject,
      preheader: row.preheader,
      blocks: row.blocks,
    },
    heroAssetUrl: row.heroAssetUrl,
    derivedImages: row.derivedImages,
    assetBase: process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  });

  if (result.errors > 0 || !result.html) {
    return { ok: false, reason: "Validation failed on re-render.", errors: result.errors };
  }

  const name = templateName(row);
  const templateId = await createTemplate(name, result.html);

  await db
    .update(newsletterCampaigns)
    .set({
      sendpulseTemplateId: String(templateId),
      status: "handed_off",
      derivedImages: result.derivedImages,
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaigns.id, row.id));

  return { ok: true, templateId, name };
}
