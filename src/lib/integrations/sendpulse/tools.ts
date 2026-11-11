import { tool } from "ai";
import { z } from "zod";
import type { ToolBrand } from "../types";
import { fetchBrandCampaigns, type BrandCampaign } from "./client";

/**
 * Read-only SendPulse email tools, bound to one brand. Campaigns are matched to
 * the brand by their sender-email domain (the connection's configured domain,
 * defaulting to the brand's `domain`), and read live from the SendPulse API.
 * Dates are YYYY-MM-DD. No writes to the account.
 */
export function sendpulseTools(brand: ToolBrand, senderDomain?: string) {
  const domain = (senderDomain || brand.domain).toLowerCase();
  const pct = (num: number, den: number) =>
    den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "0.0%";

  const row = (c: BrandCampaign) => {
    const base = c.stats.delivered || c.stats.sent;
    return {
      id: c.id,
      name: c.name ?? "",
      subject: c.message?.subject ?? "",
      date: c.date,
      sent: c.stats.sent,
      delivered: c.stats.delivered,
      opened: c.stats.opened,
      clicked: c.stats.clicked,
      unsubscribed: c.stats.unsubscribed,
      bounced: c.stats.bounced,
      openRate: pct(c.stats.opened, base),
      ctr: pct(c.stats.clicked, base),
      clickToOpenRate: pct(c.stats.clicked, c.stats.opened),
    };
  };

  return {
    sendpulseCampaigns: tool({
      description:
        `List this brand's SendPulse email campaigns sent in a date range (newest ` +
        `first), each with sent, delivered, opened, clicked, unsubscribed, bounced, ` +
        `and PRE-COMPUTED openRate, ctr, clickToOpenRate. Use for per-campaign / ` +
        `subject-line comparisons and best/worst sends. Report the rate fields ` +
        `verbatim — never recompute them yourself.`,
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ startDate, endDate, limit }) => {
        try {
          const campaigns = await fetchBrandCampaigns(domain, startDate, endDate, limit);
          return {
            brand: brand.name,
            senderDomain: domain,
            campaignCount: campaigns.length,
            campaigns: campaigns.map(row),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    sendpulseEmailSummary: tool({
      description:
        `Aggregate SendPulse email performance for this brand over a date range: ` +
        `campaignCount, sent, delivered, opened, clicked, unsubscribed, bounced, and ` +
        `PRE-COMPUTED openRate, ctr, clickToOpenRate, bounceRate, unsubscribeRate. ` +
        `Prefer this for any headline/aggregate question ("how did we do last week"). ` +
        `Report the rate fields verbatim — never recompute rates from the raw counts.`,
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const campaigns = await fetchBrandCampaigns(domain, startDate, endDate);
          const t = campaigns.reduce(
            (a, c) => {
              a.sent += c.stats.sent;
              a.delivered += c.stats.delivered;
              a.opened += c.stats.opened;
              a.clicked += c.stats.clicked;
              a.unsubscribed += c.stats.unsubscribed;
              a.bounced += c.stats.bounced;
              return a;
            },
            { sent: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 },
          );
          const base = t.delivered || t.sent;
          // All rates are pre-computed here — report them verbatim, do not recompute.
          return {
            brand: brand.name,
            senderDomain: domain,
            campaignCount: campaigns.length,
            sent: t.sent,
            delivered: t.delivered,
            opened: t.opened,
            clicked: t.clicked,
            unsubscribed: t.unsubscribed,
            bounced: t.bounced,
            openRate: pct(t.opened, base),
            ctr: pct(t.clicked, base),
            clickToOpenRate: pct(t.clicked, t.opened),
            bounceRate: pct(t.bounced, t.sent),
            unsubscribeRate: pct(t.unsubscribed, base),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
