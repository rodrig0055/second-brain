/**
 * Generate the campaign key visual.
 *
 * The hero was the one part a designer still supplied. This asks GPT Image 2.5
 * for a photographic visual only: no text, no logo, no product names. The
 * headline, badge and dates are live text laid over it by the renderer, which
 * is also why the image can be regenerated freely without touching copy.
 *
 * Reuses the image studio's prompt builder, so the brand's image-guidelines
 * doc (bloomly-sg has one) shapes the result the same way it does there.
 */
import { generateBrandImage } from "@/lib/image-models";
import { buildImagePrompt } from "@/lib/image-prompt";
import { putObject } from "@/lib/storage";
import { logImageUsage } from "@/lib/usage";
import type { Block } from "./campaign";
import { HERO_MODEL } from "./defaults";

export { HERO_MODEL, HERO_MODEL_FAST } from "./defaults";

/**
 * Where a brand sells, from its own domain.
 *
 * The prompt used to say "a Singapore flower and gift delivery brand" for every
 * brand, so Bloomly PH, Bloomly VN and Bloomly TH heroes were all generated as
 * Singaporean. Same class of bug as the storefront hardcoding fixed in 7559517.
 */
const MARKET: Record<string, string> = {
  "bloomly-sg.example": "Singapore",
  "bloomly-ph.example": "the Philippines",
  "bloomly-vn.example": "Vietnam",
  "bloomly-th.example": "Thailand",
  "acmeflorals.example": "the Philippines",
  "northwindaudio.ph": "the Philippines",
};

export function heroBrief(blocks: Block[], brandName: string, domain = ""): string {
  const hero = blocks.find((b) => b.type === "hero");
  const theme = hero
    ? [hero.badge, hero.headline, hero.headlineAccent, hero.dates].filter(Boolean).join(". ")
    : "a seasonal gifting moment";
  const products = blocks.flatMap((b) =>
    b.type === "productGrid" ? b.products.slice(0, 3) : b.type === "feature" ? [b.product] : [],
  ).slice(0, 4);

  const key = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const market = MARKET[key];
  const isAudio = key.startsWith("northwindaudio");
  const what = isAudio ? "audio and electronics retailer" : "flower and gift delivery brand";

  return [
    market
      ? `Email newsletter hero image for ${brandName}, a ${market} ${what}.`
      : `Email newsletter hero image for ${brandName}, a ${what}.`,
    `Campaign: ${theme}.`,
    products.length ? `The email features: ${products.join(", ")}.` : "",
    `Photographic, warm natural light, one or two real people receiving or holding a fresh bouquet, joyful and candid, soft lavender-white studio or outdoor backdrop.`,
    `Portrait composition with clear space in the top third for a headline that will be added separately.`,
    `ABSOLUTELY NO text, letters, numbers, logos, watermarks or badges anywhere in the image.`,
  ].filter(Boolean).join(" ");
}

export async function generateHero(opts: {
  campaignId: string;
  domain?: string;
  brandId: string;
  brandName: string;
  blocks: Block[];
  modelId?: string;
  userId?: string | null;
  teamId?: string | null;
}): Promise<{ url: string; bytes: number; model: string }> {
  const modelId = opts.modelId ?? HERO_MODEL;
  const prompt = await buildImagePrompt(opts.brandId, heroBrief(opts.blocks, opts.brandName, opts.domain ?? ""));
  const img = await generateBrandImage({
    modelId,
    prompt,
    referenceImages: [],
    // The shipped hero slices are 700x873: portrait, just under 4:5.
    aspectRatio: "4:5",
  });
  await logImageUsage({
    model: modelId,
    usage: img.usage,
    userId: opts.userId,
    brandId: opts.brandId,
    teamId: opts.teamId,
    refId: opts.campaignId,
  });
  const ext = img.mediaType.includes("png") ? "png" : "jpg";
  const { url } = await putObject(
    `newsletter/${opts.campaignId}/hero-${Date.now()}.${ext}`,
    Buffer.from(img.bytes),
    { contentType: img.mediaType },
  );
  return { url, bytes: img.bytes.length, model: modelId };
}
