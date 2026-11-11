import { jsonSchema, tool, type ToolSet } from "ai";
import type { DbConnection, ToolBrand } from "../types";
import {
  NOTE_ARG,
  VALIDATABLE_TOOLS,
  chatInputSchema,
  chatToolName,
  cmsCallKind,
} from "./calls";
import { callCmsTool, cmsTarget, listCmsTools } from "./client";
import { proposeCmsChange } from "./requests";

/**
 * The storefront CMS's own MCP tools, offered to a brand's chat.
 *
 * The tool list comes from the CMS, so a tool it adds later appears here with
 * no code change. What each call is allowed to do does not: code decides
 * (see calls.ts). Reads run straight away. Anything else is saved as a pending
 * change and drawn as a card, and reaches the CMS only when a person clicks
 * Apply, an admin for publishing. Without a person (a background pass) only
 * the reads are offered.
 */
export async function cmsTools(
  brand: ToolBrand,
  conn: DbConnection,
  ctx: { userId?: string },
): Promise<ToolSet> {
  let target: ReturnType<typeof cmsTarget>;
  let defs: Awaited<ReturnType<typeof listCmsTools>>;
  try {
    target = cmsTarget(conn);
    defs = await listCmsTools(conn);
  } catch (e) {
    // A CMS that is down or refuses the token must not break the whole chat.
    console.error("cms tools unavailable", brand.slug, e);
    return {};
  }
  const where = `${target.host} (${target.tenant} storefront${target.live ? "" : ", TEST environment"})`;

  const tools: ToolSet = {};
  for (const def of defs) {
    const kind = cmsCallKind(def.name, {});
    const writes = kind !== "read";
    if (writes && !ctx.userId) continue;

    const description =
      `${def.description}\n\nCMS: ${where}. The storefront code is added for you.` +
      (writes
        ? kind === "publish"
          ? " Calling this does NOT publish anything: it saves a pending change and shows a card where an admin must click Apply. Never say it is live after calling this."
          : " Calling this does NOT change the CMS: it saves a pending change and shows a card where the user clicks Apply. Never say it is done after calling this." +
            (def.name === "product_composition" ? " The show, catalog and member_variants actions only read and answer straight away." : "")
        : "");

    tools[chatToolName(def.name)] = tool({
      description,
      inputSchema: jsonSchema<Record<string, unknown>>(chatInputSchema(def.inputSchema, { withNote: writes })),
      execute: async (input) => {
        const { [NOTE_ARG]: note, ...args } = input;
        try {
          if (cmsCallKind(def.name, args) === "read") {
            const res = await callCmsTool(conn, def.name, args);
            return res.ok ? (res.data ?? res.text) : { error: res.text };
          }
          if (!ctx.userId) return { error: "Changing the CMS needs a person to approve it." };

          // Let the CMS check the change before anyone is asked to approve it.
          if (VALIDATABLE_TOOLS.has(def.name)) {
            const check = await callCmsTool(conn, def.name, { ...args, validate_only: true });
            if (!check.ok) {
              return { error: "The CMS rejected this change; nothing was saved. Fix these and try again.", details: check.data ?? check.text };
            }
          }

          const res = await proposeCmsChange({
            brandId: brand.id,
            conn,
            tool: def.name,
            args,
            note: typeof note === "string" ? note : undefined,
            userId: ctx.userId,
          });
          return {
            ...res,
            status: "pending approval",
            message:
              res.kind === "publish"
                ? "Saved as a pending change. Nothing is published until an admin clicks Apply on the card."
                : "Saved as a pending change. The CMS is unchanged until someone clicks Apply on the card.",
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  return tools;
}
