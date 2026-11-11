/**
 * What a CMS tool call is, decided by code rather than by the model: whether it
 * may run straight away, needs a person to click Apply, or needs an admin.
 * Pure, so the rules are tested without a CMS or a database.
 */

export type CmsCallKind = "read" | "write" | "publish";

/** Tools that only read. Anything not listed here, including a tool the CMS adds later, is a write. */
const READ_TOOLS = new Set([
  "cms_reference_data",
  "product_get",
  "banner_list",
  "banner_get",
  "flash_deal_list",
  "flash_deal_get",
  "flash_price_list",
  "flash_price_get",
]);

/** product_composition actions that only read. */
const READ_COMPOSITION_ACTIONS = new Set(["show", "catalog", "member_variants"]);

export function cmsCallKind(tool: string, args: Record<string, unknown>): CmsCallKind {
  // Every publish tool (product, banner, flash deal, flash price, and any added later) needs an admin.
  if (tool.endsWith("_publish")) return "publish";
  if (READ_TOOLS.has(tool)) return "read";
  if (tool === "product_composition" && READ_COMPOSITION_ACTIONS.has(String(args.action))) return "read";
  // The CMS runs every check and writes nothing.
  if (args.validate_only === true) return "read";
  return "write";
}

/** Tools whose writes can be checked first with validate_only. */
export const VALIDATABLE_TOOLS = new Set(["product_create", "product_update"]);

/** The chat-side name: every CMS tool starts with `cms_`, so it cannot collide with another platform's. */
export function chatToolName(tool: string): string {
  return tool.startsWith("cms_") ? tool : `cms_${tool}`;
}

/** Property the chat adds to every write tool for the card's "why" line. Never sent to the CMS. */
export const NOTE_ARG = "change_note";

/**
 * The CMS's input schema as the model sees it: without `tenant`, which code
 * adds on every call so the model can never aim at another storefront, and,
 * for writes, with an optional note for the card.
 */
export function chatInputSchema(
  schema: Record<string, unknown>,
  opts: { withNote: boolean },
): Record<string, unknown> {
  const properties = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  delete properties.tenant;
  if (opts.withNote) {
    properties[NOTE_ARG] = {
      type: "string",
      description: "One line on why this change, shown to the person who approves it. Not sent to the CMS.",
    };
  }
  const required = Array.isArray(schema.required)
    ? (schema.required as string[]).filter((r) => r !== "tenant")
    : undefined;
  return {
    ...schema,
    type: "object",
    properties,
    ...(required ? { required } : {}),
  };
}

function idList(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : "";
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

const CONNECTION_LABEL: Record<string, string> = {
  addons: "add-ons",
  experience_items: "experience items",
  related: "related products",
};

/** One line saying what a call will do, for the approval card and the log. */
export function describeCmsCall(tool: string, args: Record<string, unknown>): string {
  const id = args.product_id != null ? `product #${args.product_id}` : "a product";
  switch (tool) {
    case "product_create": {
      const variants = count(args.variants);
      const hubs = count(args.hub_ids);
      return `Create draft product "${String(args.name ?? "")}" (${variants} variant${variants === 1 ? "" : "s"} on ${hubs} hub${hubs === 1 ? "" : "s"})`;
    }
    case "product_update": {
      const fields = Object.keys(args).filter((k) => k !== "product_id" && k !== "validate_only" && k !== NOTE_ARG);
      return `Edit ${id}: ${fields.length ? fields.join(", ") : "no fields"}`;
    }
    case "product_connections": {
      const what = CONNECTION_LABEL[String(args.kind)] ?? String(args.kind ?? "connections");
      const parts = [
        count(args.add) ? `add ${idList(args.add)}` : "",
        count(args.remove) ? `remove ${idList(args.remove)}` : "",
      ].filter(Boolean);
      return `Change ${what} of ${id}: ${parts.join("; ") || "nothing"}`;
    }
    case "product_composition":
      return args.action === "set_bundle"
        ? `${args.is_bundle ? "Make" : "Stop making"} ${id} a bundle`
        : `Save bundle group "${String((args.group as { name?: unknown } | undefined)?.name ?? "")}" on ${id}`;
    case "variant_price_update": {
      const n = count(args.changes);
      return `Change price, stock or SKU of ${n} variant${n === 1 ? "" : "s"} on ${id}`;
    }
    case "variant_image_delete":
      return `Delete image ${String(args.type ?? "")} from variant #${String(args.variant_id ?? "")}`;
    case "variant_reorder":
      return `Reorder the variants of ${id}: ${idList(args.variant_ids)}`;
    case "product_video":
      return args.remove ? `Remove the video from ${id}` : `Set the video on ${id}`;
    case "product_publish":
      return `${publishVerb(args)} ${id}`;
    case "banner_create":
      return `Create unpublished ${bannerKind(args)} "${String(args.name ?? "")}" linking to ${String(args.link ?? "")}`;
    case "banner_update": {
      const fields = changedFields(args, ["banner_id", "kind"]);
      return `Edit ${bannerKind(args)} #${String(args.banner_id ?? "")}: ${fields.length ? fields.join(", ") : "no fields"}`;
    }
    case "banner_translation_set": {
      const what = [args.link != null ? "link" : "", args.image_url != null ? "image" : ""].filter(Boolean).join(" and ");
      return `Set the ${String(args.language_code ?? "")} ${what || "translation"} of ${bannerKind(args)} #${String(args.banner_id ?? "")}`;
    }
    case "banner_reorder": {
      const n = count(args.banner_ids);
      return `Reorder ${n} ${args.bloomly ? "Bloomly " : ""}${bannerKind(args)}s: ${idList(args.banner_ids)}`;
    }
    case "banner_publish":
      return `${publishVerb(args)} ${bannerKind(args)} #${String(args.banner_id ?? "")}`;
    case "flash_deal_create": {
      const n = count(args.products);
      return `Create unpublished flash deal "${String(args.title ?? "")}" (${n} product${n === 1 ? "" : "s"}, ${String(args.start_date ?? "")} to ${String(args.end_date ?? "")})`;
    }
    case "flash_deal_update": {
      const fields = changedFields(args, ["flash_deal_id"]);
      return `Edit flash deal #${String(args.flash_deal_id ?? "")}: ${fields.length ? fields.join(", ") : "no fields"}`;
    }
    case "flash_deal_publish":
      return `${publishVerb(args)} flash deal #${String(args.flash_deal_id ?? "")}`;
    case "flash_price_create":
      return `Create unpublished flash price ${String(args.price ?? "")} on variant #${String(args.variant_id ?? "")} of ${id} (${String(args.start_date ?? "")} to ${String(args.end_date ?? "")})`;
    case "flash_price_update": {
      const fields = changedFields(args, ["flash_price_id"]);
      return `Edit flash price #${String(args.flash_price_id ?? "")}: ${fields.length ? fields.join(", ") : "no fields"}`;
    }
    case "flash_price_publish":
      return `${publishVerb(args)} flash price #${String(args.flash_price_id ?? "")}`;
    default:
      return `${tool} on ${id}`;
  }
}

function bannerKind(args: Record<string, unknown>): string {
  return args.kind === "mobile" ? "app banner" : "web banner";
}

/** The fields a partial update sends, without the id it targets and the chat's own keys. */
function changedFields(args: Record<string, unknown>, ids: string[]): string[] {
  return Object.keys(args).filter((k) => !ids.includes(k) && k !== "validate_only" && k !== NOTE_ARG);
}

/** "Publish", "Unpublish" or "Change publishing of", from the flags the call sets. */
function publishVerb(args: Record<string, unknown>): string {
  const flags: boolean[] = [];
  const collect = (o: unknown) => {
    const f = (o ?? {}) as { published?: unknown; bloomly_published?: unknown };
    if (typeof f.published === "boolean") flags.push(f.published);
    if (typeof f.bloomly_published === "boolean") flags.push(f.bloomly_published);
  };
  // banner, flash deal and flash price publish tools carry their flags at the top level
  collect(args);
  collect(args.product);
  for (const v of (args.vendors as unknown[] | undefined) ?? []) collect(v);
  for (const v of (args.variants as unknown[] | undefined) ?? []) collect(v);
  if (flags.length && flags.every(Boolean)) return "Publish";
  if (flags.length && flags.every((f) => !f)) return "Unpublish";
  return "Change publishing of";
}
