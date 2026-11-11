import { tool } from "ai";
import { z } from "zod";
import type { ToolBrand } from "../types";
import { MAX_BATCH_SIZE, MAX_TITLE_LENGTH, brandMerchantAccount, merchantAccountsFor } from "./accounts";
import { catalogScan, proposeTitleBatch } from "./titles";

/**
 * Merchant Center tools for a brand's chat. Reading the catalog and PROPOSING
 * titles are tools; applying is not. A proposal is saved as a pending batch and
 * drawn as a card with an Approve button that only an admin can use.
 */
export function merchantCenterTools(brand: ToolBrand, ctx: { userId?: string }) {
  const accounts = merchantAccountsFor(brand.slug);
  if (accounts.length === 0) return {};
  const accountList = accounts
    .map((a) => `${a.id} = ${a.label}${a.live ? "" : " [not serving: safe for tests]"}`)
    .join("; ");

  return {
    merchantFindProducts: tool({
      description:
        "Search this brand's Google Merchant Center catalog (the products Google Shopping shows) by " +
        "title text, offer id or item issue code (e.g. text_value_truncated, price_mismatch). " +
        `Accounts: ${accountList}. Returns offer ids and current titles as Google has them.`,
      inputSchema: z.object({
        accountId: z.string().describe("Merchant Center account id from the list in the description."),
        query: z.string().optional().describe("Case-insensitive text to find in the title, or an exact offer id."),
        issueCode: z.string().optional().describe("Only products with this item-level issue code."),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: async ({ accountId, query, issueCode, limit }) => {
        const account = brandMerchantAccount(brand.slug, accountId);
        if (!account) return { error: `Unknown account for this brand. Use one of: ${accountList}` };
        try {
          const catalog = await catalogScan(account.id);
          const q = query?.trim().toLowerCase();
          const rows = catalog
            .filter((p) => !q || p.offerId === query?.trim() || (p.productAttributes?.title ?? "").toLowerCase().includes(q))
            .filter((p) => !issueCode || p.productStatus?.itemLevelIssues?.some((i) => i.code === issueCode))
            .slice(0, limit)
            .map((p) => ({
              offerId: p.offerId,
              contentLanguage: p.contentLanguage,
              title: p.productAttributes?.title ?? "",
              titleLength: (p.productAttributes?.title ?? "").length,
              availability: p.productAttributes?.availability ?? "",
              issues: (p.productStatus?.itemLevelIssues ?? []).map((i) => i.code).join(", "),
            }));
          return { account: account.label, catalogSize: catalog.length, matches: rows.length, products: rows };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    ...(ctx.userId
      ? {
          merchantProposeTitles: tool({
            description:
              "Propose new Google Shopping titles for products in this brand's Merchant Center account. " +
              "This does NOT change anything: it saves a pending batch and shows the user a card where an " +
              "admin must click Approve before Google gets the titles. Never say titles are live after " +
              `calling this. Max ${MAX_BATCH_SIZE} products, ${MAX_TITLE_LENGTH} characters per title. ` +
              "Get offer ids from merchantFindProducts first. Prefer the account marked safe for tests " +
              "when the user asks for a test.",
            inputSchema: z.object({
              accountId: z.string(),
              changes: z
                .array(
                  z.object({
                    offerId: z.string(),
                    newTitle: z.string(),
                    contentLanguage: z
                      .string()
                      .optional()
                      .describe("Required when the offer is listed in more than one language (e.g. th and en)."),
                  }),
                )
                .min(1)
                .max(MAX_BATCH_SIZE),
              note: z.string().optional().describe("One line on why, shown on the card."),
            }),
            execute: async ({ accountId, changes, note }) => {
              try {
                const res = await proposeTitleBatch({
                  brandId: brand.id,
                  brandSlug: brand.slug,
                  accountId,
                  changes,
                  note,
                  userId: ctx.userId,
                });
                return {
                  ...res,
                  status: "pending approval",
                  message: "Saved as a pending batch. Nothing has changed in Google until an admin clicks Approve on the card.",
                };
              } catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
              }
            },
          }),
        }
      : {}),
  };
}
