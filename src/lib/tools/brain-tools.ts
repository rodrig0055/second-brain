import type { ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { shopifyTools } from "@/lib/integrations/shopify/tools";
import { metaTools, metaWorkspaceTools } from "@/lib/integrations/meta/tools";
import { metaOrganicTools } from "@/lib/integrations/meta_organic/tools";
import { tiktokOrganicTools } from "@/lib/integrations/tiktok_organic/tools";
import { tiktokAdsTools } from "@/lib/integrations/tiktok_ads/tools";
import { googleAdsTools } from "@/lib/integrations/google_ads/tools";
import { ga4Tools } from "@/lib/integrations/ga4/tools";
import { sendpulseTools } from "@/lib/integrations/sendpulse/tools";
import { buildSeoTools, hasGscDataset } from "@/lib/tools/seo-tools";
import { webTools } from "@/lib/tools/web-tools";
import { knowledgeTools, skillTools } from "@/lib/tools/skill-tools";
import { storefrontTools } from "@/lib/tools/storefront-tools";
import { merchantCenterTools } from "@/lib/integrations/merchant_center/tools";
import { cmsTools } from "@/lib/integrations/cms/tools";
import { hasCapability, workspacePlatforms } from "@/lib/workspaces";
import type { ToolBrand } from "@/lib/integrations/types";

/**
 * Assemble the live "brain" tools for a brand, scoped to the team's channel(s)
 * when its workspace declares platforms (else all connected platforms). Each
 * platform contributes brand-bound tools that read our synced data (and, where
 * useful, hit the platform live). Empty set if nothing applies.
 */
export async function buildBrainTools(
  brand: ToolBrand,
  teamSlug?: string,
  /**
   * Who is asking. Present for a chat, absent for a background pass, which is
   * what gates the tools that write.
   */
  actor?: { userId: string },
): Promise<ToolSet> {
  const conns = await db.query.integrationConnections.findMany({
    where: and(
      eq(integrationConnections.brandId, brand.id),
      eq(integrationConnections.status, "connected"),
    ),
  });

  // Which platforms this team may query, from the workspace registry. A team
  // with no entry there — and a call with no team at all, as the loops engine
  // makes — gets every connected platform. Scoped teams stay on their own
  // channel, so a Meta Ads chat cannot answer "yesterday's performance" with
  // GA4 sessions or Shopify revenue. Drafting is NOT scoped by this; it is
  // gated on the team's own capability inside metaOrganicTools.
  const allowed = workspacePlatforms(teamSlug);
  const scoped = allowed
    ? conns.filter((c) => allowed.includes(c.platform))
    : conns;

  let tools: ToolSet = {};
  for (const conn of scoped) {
    if (conn.platform === "shopify") {
      tools = { ...tools, ...shopifyTools(brand, conn) };
    } else if (conn.platform === "meta") {
      tools = {
        ...tools,
        ...metaTools(brand),
        ...metaWorkspaceTools(brand, conn, { teamSlug, userId: actor?.userId }),
      };
    } else if (conn.platform === "meta_organic") {
      tools = { ...tools, ...metaOrganicTools(brand, teamSlug) };
    } else if (conn.platform === "tiktok") {
      tools = { ...tools, ...tiktokAdsTools(brand) };
    } else if (conn.platform === "tiktok_organic") {
      tools = { ...tools, ...tiktokOrganicTools(brand, teamSlug, conn.id) };
    } else if (conn.platform === "google_ads") {
      tools = { ...tools, ...googleAdsTools(brand) };
    } else if (conn.platform === "ga4") {
      tools = { ...tools, ...ga4Tools(brand, conn) };
    } else if (conn.platform === "sendpulse") {
      const senderDomain = String(conn.config.senderDomain ?? brand.domain);
      tools = { ...tools, ...sendpulseTools(brand, senderDomain) };
    }
  }

  // GSC isn't a stored "connection" — it's configured per-brand via the
  // GSC_BQ_DATASETS env map and read live from BigQuery. Attach its tools
  // (Search Console + Ahrefs) for the SEO team (or any unscoped call) when the
  // brand has a dataset configured.
  const gscAllowed = !teamSlug || hasCapability(teamSlug, "gscTools");
  if (gscAllowed && hasGscDataset(brand)) {
    tools = { ...tools, ...buildSeoTools(brand) };
  }

  // Generic web-fetch is safe and useful everywhere (reading a URL the user
  // pastes), so every chat gets it regardless of team scoping.
  tools = { ...tools, ...webTools() };

  // load_skill: lets the agent pull a skill's full steps on demand (the Skills
  // index in the system prompt tells it which slug to load). Available to every
  // chat/task; the tool itself scopes results to this brand + team.
  tools = { ...tools, ...skillTools(brand, teamSlug) };
  // knowledge_read: the same on-demand move for ordinary docs. The catalog in
  // the system prompt names what exists but is not included (winners and
  // lessons past their caps); this is how the agent actually reads one.
  tools = { ...tools, ...knowledgeTools(brand, teamSlug) };

  // Storefront catalog/sitemap history is relevant to SEO and commercial work
  // (and any unscoped chat). Meta/newsletter chats stay channel-scoped.
  const storefrontAllowed = !teamSlug || hasCapability(teamSlug, "storefrontTools");
  if (storefrontAllowed) {
    tools = { ...tools, ...storefrontTools(brand) };
  }

  // Merchant Center (Google Shopping catalog) is configured per brand in code,
  // not as a stored connection. Proposing titles needs a person (actor): the
  // proposal is applied only from the chat card, by an admin.
  if (hasCapability(teamSlug, "merchantCenterTools")) {
    tools = { ...tools, ...merchantCenterTools(brand, { userId: actor?.userId }) };
  }


  // The storefront CMS goes by capability, not by the team's platform list, so
  // Commercial (scoped to Shopify + GA4) gets it too. Writes need a person
  // (actor): each one is applied only from its chat card.
  if (hasCapability(teamSlug, "cmsTools")) {
    const cms = conns.find((c) => c.platform === "cms");
    if (cms) tools = { ...tools, ...(await cmsTools(brand, cms, { userId: actor?.userId })) };
  }

  return tools;
}

/** True when the brand has at least one connected integration. */
export async function brandHasConnections(brandId: string): Promise<boolean> {
  const row = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.status, "connected"),
    ),
  });
  return !!row;
}
