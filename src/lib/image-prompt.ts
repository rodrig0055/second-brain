import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { brands, knowledgeDocs } from "@/db/schema";

/**
 * Standing visual contract applied to every generation, ahead of brand- and
 * brief-specific instructions. Keeps models from inventing brand marks: a logo
 * may only appear if it was supplied as a reference image, in which case it
 * should be composited cleanly into the creative.
 */
const SYSTEM_DIRECTIVE = [
  "Do not invent, hallucinate, or draw any brand logo, wordmark, or icon from memory.",
  "Only include a logo if one is provided as a reference image; in that case reproduce it exactly as given and place it naturally and unobtrusively within the composition (do not distort, recolor, or redraw it).",
  "If no logo reference is attached, leave the design logo-free rather than guessing one.",
  "Never render fake or garbled text resembling a brand name in place of a real logo.",
].join(" ");

/**
 * Assembles the visual instruction for an image generation:
 * 1. global master prompt (behavioral contract)
 * 2. brand voice + image guidelines for the chosen brand
 * 3. the user's brief
 * Mirrors the doc-querying pattern in src/lib/prompt.ts.
 */
export async function buildImagePrompt(
  brandId: string,
  brief: string,
  pageContext?: string | null,
): Promise<string> {
  const [brand, docs] = await Promise.all([
    db.query.brands.findFirst({ where: eq(brands.id, brandId) }),
    db.query.knowledgeDocs.findMany({
      where: and(
        eq(knowledgeDocs.isActive, true),
        or(
          and(
            eq(knowledgeDocs.kind, "master-prompt"),
            isNull(knowledgeDocs.brandId),
          ),
          and(
            eq(knowledgeDocs.brandId, brandId),
            inArray(knowledgeDocs.kind, ["brand-voice", "image-guidelines"]),
          ),
        ),
      ),
      orderBy: [desc(knowledgeDocs.updatedAt)],
    }),
  ]);

  const parts: string[] = [`# Image rules\n${SYSTEM_DIRECTIVE}`];

  const master = docs.find((d) => d.kind === "master-prompt");
  if (master) parts.push(master.content);

  parts.push(
    `Brand: ${brand?.name ?? "unknown"} (${brand?.domain ?? "-"}). Create on-brand marketing imagery. Match the brand's visual identity exactly. If reference images are provided, treat them as the product/style source of truth and keep products accurate.`,
  );

  for (const doc of docs.filter((d) => d.kind === "brand-voice")) {
    parts.push(`# Brand voice\n${doc.content}`);
  }
  for (const doc of docs.filter((d) => d.kind === "image-guidelines")) {
    parts.push(`# Visual guidelines\n${doc.content}`);
  }

  if (pageContext && pageContext.trim()) {
    parts.push(
      `# Source page context\nThe brief references this product/collection page. Use it to keep the product, naming, and details accurate — but follow the brand's visual guidelines for styling.\n\n${pageContext.trim()}`,
    );
  }

  parts.push(`# Creative brief\n${brief}`);

  return parts.join("\n\n");
}
