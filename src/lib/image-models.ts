import { generateImage } from "ai";
import sharp from "sharp";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getProviderApiKey } from "@/lib/llm-keys";
import { gifFrameSize, isSafeSvg, type OutputSpec } from "@/lib/image-output";
import { takesSettings, type ImageSettings } from "@/lib/image-settings";

// Client-safe model metadata lives in its own module (no db/AI-SDK imports) so
// client components don't pull the database into the browser bundle. Re-export
// it here for server-side callers that already import from this module.
export {
  IMAGE_MODEL_OPTIONS,
  imageModelLabel,
  type ImageModelId,
} from "@/lib/image-model-options";

async function resolveImageModel(id: string) {
  const [provider, ...rest] = id.split("/");
  const name = rest.join("/");
  if (provider === "openai") {
    return createOpenAI({ apiKey: await getProviderApiKey("openai") }).image(
      name,
    );
  }
  if (provider === "google") {
    return createGoogleGenerativeAI({
      apiKey: await getProviderApiKey("google"),
    }).image(name);
  }
  throw new Error(`Unknown image model: ${id}`);
}

export type ReferenceImage = { bytes: Uint8Array; mediaType: string };

/** Token usage of one image call, for logImageUsage. */
export type ImageUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Share of inputTokens from reference images, when the provider says. */
  imageInputTokens?: number;
  /**
   * SVG output only: the text model that wrote the vector. It bills at its own
   * text rates on top of the image model's reference render.
   */
  author?: { model: string; inputTokens: number; outputTokens: number };
};

/** Parse a "w:h" aspect ratio string into a numeric ratio (w / h). */
function ratioOf(aspectRatio: `${number}:${number}`): number {
  const [w, h] = aspectRatio.split(":").map(Number);
  return h > 0 ? w / h : 1;
}

/**
 * OpenAI's GPT Image 2.5 and 2.6 families: `flare` is the fast everyday model,
 * `sunburst` the slower top-quality one. Both generations take arbitrary output
 * sizes and two extra quality tiers, so they are configured differently from
 * gpt-image-1/2 below. 2.6 also takes a `complexity` (planning) setting; it is
 * left at the model default (`high`) because @ai-sdk/openai builds the request
 * body field by field and would drop it anyway.
 */
function isGptImage25(modelId: string): boolean {
  return (
    modelId.startsWith("openai/gpt-image-2.5") ||
    modelId.startsWith("openai/gpt-image-2.6")
  );
}

/**
 * The older gpt-image models ignore `aspectRatio` and only honour `size`, from
 * a fixed set of three, so snap the requested ratio to the nearest portrait /
 * square / landscape option.
 */
function openaiSize(aspectRatio: `${number}:${number}`): `${number}x${number}` {
  const r = ratioOf(aspectRatio);
  if (r < 0.9) return "1024x1536"; // portrait (4:5, 9:16, 2:3)
  if (r > 1.1) return "1536x1024"; // landscape (16:9, 1.91:1)
  return "1024x1024"; // square
}

// GPT Image 2.5 accepts any "WIDTHxHEIGHT" size whose edges are both multiples
// of 16, provided the longer:shorter edge ratio is at most 3:1, neither edge
// exceeds 3840px, and the total lands between 655,360 and 8,294,400 pixels.
const GPT_IMAGE_25_MIN_PIXELS = 655_360;
const GPT_IMAGE_25_MAX_EDGE = 3840;
// Target ~1MP: the same output-token band as the fixed 1024x1536 sizes the
// older models use, so 2.5 buys exact framing rather than a bigger bill. Raise
// this (up to 3,686,400 before OpenAI calls the size experimental) to trade
// cost for resolution.
const GPT_IMAGE_25_TARGET_PIXELS = 1024 * 1024;

/** Round to the nearest legal 16px step, inside the per-edge ceiling. */
function step16(px: number): number {
  return Math.min(
    GPT_IMAGE_25_MAX_EDGE,
    Math.max(16, Math.round(px / 16) * 16),
  );
}

// Above this OpenAI calls a 2.5 size experimental, so custom sizes stop here
// and anything bigger is upscaled afterwards instead.
const GPT_IMAGE_25_MAX_STANDARD_PIXELS = 3_686_400;

/**
 * Turn a platform aspect ratio into an exact GPT Image 2.5 size. Unlike the
 * three-size snap above this renders 9:16 stories and 1.91:1 feed ads at their
 * real shape, so nothing has to be cropped afterwards.
 */
function gptImage25Size(
  aspectRatio: `${number}:${number}`,
  targetPixels = GPT_IMAGE_25_TARGET_PIXELS,
): `${number}x${number}` {
  const r = Math.min(Math.max(ratioOf(aspectRatio), 1 / 3), 3);
  // Anchor on the height, then derive the width from the rounded height: that
  // keeps the delivered ratio closer to the request than rounding both edges
  // independently.
  let h = step16(Math.sqrt(targetPixels / r));
  let w = step16(h * r);
  // Rounding down can dip under the minimum pixel count on extreme ratios;
  // grow the pair a step at a time until it clears (bounded, so it always ends).
  for (let i = 0; i < 8 && w * h < GPT_IMAGE_25_MIN_PIXELS; i++) {
    h = step16(h + 16);
    w = step16(h * r);
  }
  return `${w}x${h}`;
}

/**
 * A custom size asks for real pixels, so 2.5 renders at the requested pixel
 * count (inside its legal band) rather than the ~1MP preset target. Presets
 * keep the cheaper target; a custom size is an explicit request for resolution.
 */
function gptImage25CustomSize(size: {
  width: number;
  height: number;
}): `${number}x${number}` {
  const pixels = Math.min(
    Math.max(size.width * size.height, GPT_IMAGE_25_MIN_PIXELS),
    GPT_IMAGE_25_MAX_STANDARD_PIXELS,
  );
  return gptImage25Size(`${size.width}:${size.height}`, pixels);
}

/**
 * `xhigh` and `max` only exist on GPT Image 2.5 and 2.6. Sunburst is the model you pick
 * when the render matters, so it gets the extra tier; Flare is the everyday
 * model and stays at `high`, which is also where the older models cap out.
 */
function openaiQuality(modelId: string, fineDetail = false): "high" | "xhigh" {
  if (isGptImage25(modelId) && modelId.endsWith("-sunburst")) return "xhigh";
  // A brief with legible text or small detail earns Flare 2.6 the step up.
  return fineDetail && takesSettings(modelId) ? "xhigh" : "high";
}

/** The 2.6-only fields for a request body: planning depth and quality. */
function settingsFields(modelId: string, settings?: ImageSettings) {
  return {
    quality: openaiQuality(modelId, settings?.fineDetail),
    ...(settings && takesSettings(modelId) ? { complexity: settings.complexity } : {}),
  };
}

/**
 * Gemini image models accept only a small aspectRatio enum; snap arbitrary
 * platform ratios to the closest supported value.
 */
function geminiAspectRatio(
  aspectRatio: `${number}:${number}`,
): "1:1" | "3:4" | "4:3" | "9:16" | "16:9" {
  const supported: Array<["1:1" | "3:4" | "4:3" | "9:16" | "16:9", number]> = [
    ["9:16", 9 / 16],
    ["3:4", 3 / 4],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["16:9", 16 / 9],
  ];
  const r = ratioOf(aspectRatio);
  return supported.reduce((best, cur) =>
    Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best,
  )[0];
}

/**
 * Generates a single image for one model + aspect ratio, grounded in the
 * assembled brand prompt and any reference images. OpenAI (gpt-image-2.6 and
 * 2.5 flare / sunburst, gpt-image-2) and Google (gemini-nano-banana-2.1) all run through the unified `generateImage` API, which accepts
 * reference images on the prompt object.
 *
 * Each provider expects framing + quality configured differently, so the
 * single requested `aspectRatio` is translated per-provider here.
 */
export async function generateBrandImage({
  modelId,
  prompt,
  referenceImages,
  aspectRatio,
  size,
  output = { kind: "image" },
  settings,
}: {
  modelId: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  aspectRatio: `${number}:${number}`;
  /** Exact output pixels (custom formats). The result is fitted to it. */
  size?: { width: number; height: number };
  /** Still image (default), animated GIF or vector SVG (2.6 only). */
  output?: OutputSpec;
  /** Planning depth and detail (GPT Image 2.6 only; ignored elsewhere). */
  settings?: ImageSettings;
}): Promise<{ bytes: Uint8Array; mediaType: string; usage: ImageUsage }> {
  if (output.kind === "gif") {
    return generateGif({ modelId, prompt, referenceImages, aspectRatio, size, settings, ...output });
  }
  if (output.kind === "svg") {
    return generateSvg({ modelId, prompt, aspectRatio, size, settings });
  }
  // 2.6 stills go direct too: the SDK cannot send `complexity`.
  if (takesSettings(modelId)) {
    const r = await generateStill26({ modelId, prompt, referenceImages, aspectRatio, size, settings });
    const fitted = size ? await fitToSize(r.bytes, r.mediaType, size) : r;
    return { ...fitted, usage: r.usage };
  }
  const model = await resolveImageModel(modelId);
  const isOpenAI = modelId.startsWith("openai/");
  const hasRefs = referenceImages.length > 0;

  const result = await generateImage({
    model,
    prompt: hasRefs
      ? { text: prompt, images: referenceImages.map((r) => r.bytes) }
      : prompt,
    // OpenAI honours `size`; Google honours `aspectRatio`. Set only the one
    // each provider supports so the other isn't silently dropped.
    ...(isOpenAI
      ? {
          size: isGptImage25(modelId)
            ? size
              ? gptImage25CustomSize(size)
              : gptImage25Size(aspectRatio)
            : openaiSize(aspectRatio),
        }
      : { aspectRatio: geminiAspectRatio(aspectRatio) }),
    providerOptions: isOpenAI
      ? {
          openai: {
            quality: openaiQuality(modelId),
            outputFormat: "png",
            // Note: neither gpt-image-2 nor gpt-image-2.5 accepts
            // `input_fidelity` (it was a gpt-image-1 option). 2.5 always edits
            // at high fidelity, so there is nothing to opt into.
          },
        }
      : {},
  });

  const bytes = result.image.uint8Array;
  const mediaType = result.image.mediaType ?? "image/png";
  // OpenAI splits input into text and reference-image tokens per image in its
  // provider metadata; they bill at different rates.
  const openaiImages = result.providerMetadata?.openai?.images as
    | { imageTokens?: number }[]
    | undefined;
  const imageInputTokens = openaiImages?.some((i) => i.imageTokens != null)
    ? openaiImages.reduce((n, i) => n + (i.imageTokens ?? 0), 0)
    : undefined;
  const usage: ImageUsage = {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    imageInputTokens,
  };
  const fitted = size
    ? await fitToSize(bytes, mediaType, size)
    : { bytes, mediaType };
  return { ...fitted, usage };
}

/**
 * Deliver a custom format at exactly the pixels asked for. 2.5 lands within a
 * 16px step of the shape (and may be scaled for its pixel band), so this is a
 * light resize; GPT Image 2 and Gemini only have fixed shapes, so for them it
 * is a centre crop. Skipped when the render already matches.
 */
async function fitToSize(
  bytes: Uint8Array,
  mediaType: string,
  size: { width: number; height: number },
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const meta = await sharp(bytes).metadata();
  if (meta.width === size.width && meta.height === size.height) {
    return { bytes, mediaType };
  }
  const png = await sharp(bytes)
    .resize(size.width, size.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(png), mediaType: "image/png" };
}

// ---------------------------------------------------------------------------
// GIF and SVG output (GPT Image 2.6). @ai-sdk/openai only knows png/jpeg/webp
// and builds the request body field by field, so these call the Image API
// directly. GIF takes reference images on the edit endpoint (probed live
// 2026-11-06); SVG is sent as a generation only, so it never gets them.

// The text model that authors the SVG from the image model's reference render.
// Picked 2026-11-05 from a side-by-side of gpt-5.4-mini, gpt-5.5 and gpt-6.1
// models; it must have a MODEL_PRICING row so the usage log can cost it.
export const SVG_AUTHOR_MODEL = "openai/gpt-6.1-sol";

type OpenAIImageResponse = {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number };
  };
  svg_usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

async function openaiImagesRequest(body: Record<string, unknown> | FormData) {
  const isEdit = body instanceof FormData;
  const res = await fetch(
    `https://api.openai.com/v1/images/${isEdit ? "edits" : "generations"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getProviderApiKey("openai")}`,
        // FormData sets its own multipart boundary.
        ...(isEdit ? {} : { "Content-Type": "application/json" }),
      },
      body: isEdit ? body : JSON.stringify(body),
    },
  );
  const json = (await res.json().catch(() => ({}))) as OpenAIImageResponse;
  const b64 = json.data?.[0]?.b64_json;
  if (!res.ok || !b64) {
    throw new Error(json.error?.message ?? `OpenAI image request failed (${res.status})`);
  }
  return { bytes: new Uint8Array(Buffer.from(b64, "base64")), json };
}

function baseUsage(json: OpenAIImageResponse): ImageUsage {
  return {
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    imageInputTokens: json.usage?.input_tokens_details?.image_tokens,
  };
}

async function generateGif({
  modelId,
  prompt,
  referenceImages,
  aspectRatio,
  size,
  frames,
  frameMs,
  settings,
}: {
  modelId: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  aspectRatio: `${number}:${number}`;
  size?: { width: number; height: number };
  frames: number;
  frameMs: number;
  settings?: ImageSettings;
}): Promise<{ bytes: Uint8Array; mediaType: string; usage: ImageUsage }> {
  const ratio: `${number}:${number}` = size ? `${size.width}:${size.height}` : aspectRatio;
  // Our frame size is a first guess at OpenAI's sheet layout; if it says no
  // sheet fits, shrink and ask again rather than failing the run.
  let last: unknown;
  for (const shrink of [1, 0.7, 0.45]) {
    try {
      const { bytes, json } = await openaiImagesRequest(
        withReferences(
          {
            model: modelId.replace(/^openai\//, ""),
            prompt:
              `${prompt}\n\nAnimate this as a short seamless loop: describe one clear motion ` +
              `that returns to its starting pose.`,
            size: gifFrameSize(ratio, frames, shrink),
            ...settingsFields(modelId, settings),
            output_format: "gif",
            frame_count: frames,
            frame_duration_ms: frameMs,
          },
          referenceImages,
        ),
      );
      const fitted = size ? await fitGifToSize(bytes, size) : bytes;
      return { bytes: fitted, mediaType: "image/gif", usage: baseUsage(json) };
    } catch (e) {
      last = e;
      if (!/No supported sheet fits|pixel budget/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw last;
}

/** Resize every frame of an animated GIF to a custom format's exact pixels. */
async function fitGifToSize(
  bytes: Uint8Array,
  size: { width: number; height: number },
): Promise<Uint8Array> {
  const out = await sharp(bytes, { animated: true })
    .resize(size.width, size.height, { fit: "cover", position: "centre" })
    .gif()
    .toBuffer();
  return new Uint8Array(out);
}

async function generateSvg({
  modelId,
  prompt,
  aspectRatio,
  size,
  settings,
}: {
  modelId: string;
  prompt: string;
  aspectRatio: `${number}:${number}`;
  size?: { width: number; height: number };
  settings?: ImageSettings;
}): Promise<{ bytes: Uint8Array; mediaType: string; usage: ImageUsage }> {
  const { bytes, json } = await openaiImagesRequest({
    model: modelId.replace(/^openai\//, ""),
    prompt,
    // Shapes the reference render the author model traces, so the SVG's
    // viewBox comes out at the format's ratio.
    size: size ? gptImage25CustomSize(size) : gptImage25Size(aspectRatio),
    ...settingsFields(modelId, settings),
    output_format: "svg",
    n: 1,
    svg: {
      model: SVG_AUTHOR_MODEL.replace(/^openai\//, ""),
      reasoning: { effort: "low" },
    },
  });
  if (!isSafeSvg(new TextDecoder().decode(bytes))) {
    throw new Error("The SVG came back with active content and was discarded.");
  }
  return {
    bytes,
    mediaType: "image/svg+xml",
    usage: {
      ...baseUsage(json),
      author: {
        model: SVG_AUTHOR_MODEL,
        inputTokens: json.svg_usage?.input_tokens ?? 0,
        outputTokens: json.svg_usage?.output_tokens ?? 0,
      },
    },
  };
}

/**
 * With references the request becomes an edit: multipart, every reference as
 * `image[]`. Without them it stays a JSON generation. Fields must be flat.
 */
function withReferences(
  fields: Record<string, string | number>,
  referenceImages: ReferenceImage[],
): Record<string, unknown> | FormData {
  if (referenceImages.length === 0) return fields;
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
  referenceImages.forEach((r, i) =>
    form.append(
      "image[]",
      new Blob([Buffer.from(r.bytes)], { type: r.mediaType }),
      `reference-${i + 1}.png`,
    ),
  );
  return form;
}

/**
 * A GPT Image 2.6 still, sent direct so it can carry `complexity`. With
 * references it is an edit (multipart, every reference as `image[]`), exactly
 * the request the SDK would have built, plus the 2.6 fields.
 */
async function generateStill26({
  modelId,
  prompt,
  referenceImages,
  aspectRatio,
  size,
  settings,
}: {
  modelId: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  aspectRatio: `${number}:${number}`;
  size?: { width: number; height: number };
  settings?: ImageSettings;
}): Promise<{ bytes: Uint8Array; mediaType: string; usage: ImageUsage }> {
  const fields = {
    model: modelId.replace(/^openai\//, ""),
    prompt,
    size: size ? gptImage25CustomSize(size) : gptImage25Size(aspectRatio),
    output_format: "png",
    ...settingsFields(modelId, settings),
  };
  const { bytes, json } = await openaiImagesRequest(withReferences(fields, referenceImages));
  return { bytes, mediaType: "image/png", usage: baseUsage(json) };
}
