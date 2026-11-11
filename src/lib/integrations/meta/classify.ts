import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { fetchVideoSource, type MetaTarget, type NormalizedCreative } from "./client";

/**
 * AI classification of a single Meta ad creative. We send the actual media
 * (full video to Gemini, or the static/thumbnail image) plus the ad copy and
 * ask for four fixed-enum labels. The enums are intentionally closed so the
 * dashboards can aggregate win-rate by category. Only Gemini (of our wired
 * providers) accepts native video input, hence the Gemini default model.
 */

export const ASSET_TYPES = [
  "static_image",
  "carousel",
  "video",
  "ugc_video",
  "motion_graphic",
  "product_demo",
] as const;

export const MESSAGING_ANGLES = [
  "pain_point",
  "social_proof",
  "offer_discount",
  "product_feature",
  "aspirational",
  "curiosity",
  "authority",
  "urgency_scarcity",
] as const;

export const HOOK_TACTICS = [
  "question",
  "bold_claim",
  "pattern_interrupt",
  "testimonial",
  "problem_agitation",
  "stat_shock",
  "before_after",
  "direct_offer",
] as const;

export const FUNNEL_STAGES = ["TOF", "MOF", "BOF"] as const;

export const creativeClassificationSchema = z.object({
  assetType: z
    .enum(ASSET_TYPES)
    .describe(
      "Creative format: static_image, carousel, video, ugc_video (creator/phone-shot testimonial feel), motion_graphic (animated text/graphics), product_demo (shows the product in use).",
    ),
  messagingAngle: z
    .enum(MESSAGING_ANGLES)
    .describe(
      "The dominant persuasion angle of the messaging: pain_point, social_proof, offer_discount, product_feature, aspirational, curiosity, authority (expert/credential), urgency_scarcity.",
    ),
  hookTactic: z
    .enum(HOOK_TACTICS)
    .describe(
      "The opening hook tactic in the first 1-3 seconds / headline: question, bold_claim, pattern_interrupt, testimonial, problem_agitation, stat_shock, before_after, direct_offer.",
    ),
  funnelStage: z
    .enum(FUNNEL_STAGES)
    .describe(
      "Intended funnel stage: TOF (awareness/broad hook, little product detail), MOF (consideration, benefits/proof), BOF (conversion, offer/price/direct CTA).",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Your confidence in this classification, 0-1."),
  rationale: z
    .string()
    .describe("One concise sentence explaining the classification."),
});

export type CreativeClassification = z.infer<typeof creativeClassificationSchema>;

// A video-capable, low-cost Gemini model. Video input is Gemini-only among our
// wired providers (see src/lib/models.ts MODEL_OPTIONS).
export const CLASSIFY_MODEL = PASS_MODELS.metaClassify;

// Inline media cap. Gemini accepts inline (base64) media up to ~20MB per
// request; above this we fall back to the thumbnail image + lowered confidence.
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

async function fetchBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      mediaType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a senior performance-marketing creative strategist. You are given a " +
  "Meta (Facebook/Instagram) ad's media and copy. Watch/read it carefully and " +
  "classify it precisely using the provided categories. Judge the hook from the " +
  "first few seconds of video or the headline/opening line of a static. Base the " +
  "funnel stage on how much the creative assumes prior awareness. Be decisive.";

export type ClassifyResult = {
  classification: CreativeClassification;
  usedFallback: boolean; // true when video was too large and we used the thumbnail
};

/**
 * Classify one creative. Sends the real media to the model where possible:
 * full video (if under the inline cap) for video ads, otherwise the static /
 * thumbnail image. Ad copy is always included as text context.
 */
export async function classifyCreative(
  creative: NormalizedCreative,
  target: MetaTarget,
  ctx: { userId?: string | null; brandId?: string | null; teamId?: string | null },
): Promise<ClassifyResult> {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType?: string }
    | { type: "file"; data: Uint8Array; mediaType: string }
  > = [];

  let usedFallback = false;

  // --- media ---
  if (creative.mediaType === "video" && creative.videoId) {
    const source = await fetchVideoSource(target, creative.videoId);
    const media = source ? await fetchBytes(source) : null;
    if (media && media.bytes.byteLength <= MAX_INLINE_BYTES) {
      parts.push({
        type: "file",
        data: media.bytes,
        mediaType: media.mediaType.startsWith("video/")
          ? media.mediaType
          : "video/mp4",
      });
    } else {
      // Video missing or too large — fall back to the cover thumbnail.
      usedFallback = true;
      const thumb = creative.thumbnailUrl
        ? await fetchBytes(creative.thumbnailUrl)
        : null;
      if (thumb) {
        parts.push({ type: "image", image: thumb.bytes, mediaType: thumb.mediaType });
      }
    }
  } else {
    const imgUrl = creative.imageUrl ?? creative.thumbnailUrl;
    const img = imgUrl ? await fetchBytes(imgUrl) : null;
    if (img) {
      parts.push({ type: "image", image: img.bytes, mediaType: img.mediaType });
    }
  }

  // --- copy / context ---
  const copy = [
    `Ad name: ${creative.adName || "(none)"}`,
    `Campaign objective: ${creative.objective || "(unknown)"}`,
    `Media type: ${creative.mediaType}${usedFallback ? " (analyzing thumbnail — full video unavailable)" : ""}`,
    creative.title ? `Headline: ${creative.title}` : "",
    creative.body ? `Primary text: ${creative.body}` : "",
    creative.callToAction ? `Call to action: ${creative.callToAction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  parts.push({
    type: "text",
    text: `Classify this ad creative.\n\n${copy}`,
  });

  const messages: ModelMessage[] = [{ role: "user", content: parts }];

  const model = await resolveModel(CLASSIFY_MODEL);
  const { object, usage } = await generateObject({
    model,
    schema: creativeClassificationSchema,
    system: SYSTEM_PROMPT,
    messages,
  });

  await logUsage({
    kind: "task",
    model: CLASSIFY_MODEL,
    usage,
    userId: ctx.userId,
    brandId: ctx.brandId,
    teamId: ctx.teamId,
    refId: creative.adId,
  });

  // Lower reported confidence when we couldn't see the full video.
  const classification = usedFallback
    ? { ...object, confidence: Math.min(object.confidence, 0.6) }
    : object;

  return { classification, usedFallback };
}
