// USD per 1M tokens for the image studio's models, used for the /admin/usage
// cost estimate. Image models bill text input, image input (reference images)
// and image output at different rates, so they get their own table rather than
// MODEL_PRICING's {in, out}. Published standard rates, checked 2026-10-20.
// Gemini bills text and image input at one rate.
export const IMAGE_MODEL_PRICING: Record<
  string,
  { textIn: number; imageIn: number; out: number }
> = {
  // 2.6 (2026-11-05) publishes the same standard rates as 2.5.
  "openai/gpt-image-2.6-flare": { textIn: 5, imageIn: 8, out: 30 },
  "openai/gpt-image-2.6-sunburst": { textIn: 5, imageIn: 8, out: 30 },
  "openai/gpt-image-2.5-flare": { textIn: 5, imageIn: 8, out: 30 },
  "openai/gpt-image-2.5-sunburst": { textIn: 5, imageIn: 8, out: 30 },
  "openai/gpt-image-2": { textIn: 5, imageIn: 8, out: 30 },
  // Image output rate. Its thinking tokens bill as text at $7.50, so a call
  // with heavy thinking is slightly understated here.
  "google/gemini-nano-banana-2.1": { textIn: 1.5, imageIn: 1.5, out: 30 },
  // Retired ids kept for pricing only: older generations still carry them.
  "google/gemini-3-pro-image": { textIn: 2, imageIn: 2, out: 120 },
  "google/gemini-3-pro-image-preview": { textIn: 2, imageIn: 2, out: 120 },
};

// Unknown models price at the most expensive output rate, so a model added to
// the studio without a price overstates the estimate instead of hiding it.
const FALLBACK = { textIn: 5, imageIn: 8, out: 120 };

/**
 * Estimated cost of one image call. `imageInputTokens` is the share of
 * `inputTokens` that came from reference images; when the provider does not
 * report the split, all input prices at the image rate (the higher one).
 */
export function estimateImageCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  imageInputTokens?: number,
): number {
  const price = IMAGE_MODEL_PRICING[model] ?? FALLBACK;
  const imageIn = Math.min(imageInputTokens ?? inputTokens, inputTokens);
  const textIn = inputTokens - imageIn;
  return (
    (textIn / 1_000_000) * price.textIn +
    (imageIn / 1_000_000) * price.imageIn +
    (outputTokens / 1_000_000) * price.out
  );
}
