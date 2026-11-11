// What the studio renders: a still image (every model), or, on GPT Image 2.6
// only, an animated GIF or a vector SVG. Client-safe: the studio imports the
// options, the generate route validates against them, image-models renders.

export const OUTPUT_KINDS = [
  {
    id: "image",
    label: "Still image",
    hint: "PNG from any model, with reference images.",
  },
  {
    id: "gif",
    label: "Animated GIF",
    hint: "A short looping animation from the brief and any reference images. GPT Image 2.6 only.",
  },
  {
    id: "svg",
    label: "Vector SVG",
    hint: "Editable paths for icons and flat illustrations. GPT Image 2.6 only; references are not used.",
  },
] as const;

export type OutputKind = (typeof OUTPUT_KINDS)[number]["id"];

export type OutputSpec =
  | { kind: "image" }
  | { kind: "gif"; frames: number; frameMs: number }
  | { kind: "svg" };

// Frame counts the studio offers. OpenAI takes 2 to 64, but every frame shares
// one sheet's pixel budget, so more frames means smaller ones; 16 at a square
// format still lands at 512px a side.
export const GIF_FRAME_OPTIONS = [6, 9, 16] as const;
export const GIF_SPEED_OPTIONS = [
  { label: "Fast", frameMs: 100 },
  { label: "Normal", frameMs: 200 },
  { label: "Slow", frameMs: 400 },
] as const;
export const GIF_DEFAULT_FRAMES = 9;
export const GIF_DEFAULT_FRAME_MS = 200;

/** Only the 2.6 family renders GIF and SVG (the Image API's own restriction). */
export function supportsOutput(modelId: string, kind: OutputKind): boolean {
  return kind === "image" || modelId.startsWith("openai/gpt-image-2.6");
}

/**
 * Whether reference images reach the model. GIF runs on /images/edits too
 * (probed live 2026-11-06); SVG is still sent as a generation only.
 */
export function usesReferences(kind: OutputKind): boolean {
  return kind !== "svg";
}

export function outputKind(raw: string | null | undefined): OutputKind {
  return OUTPUT_KINDS.find((k) => k.id === raw)?.id ?? "image";
}

/** Parse the studio's form fields into a spec, clamping to what is offered. */
export function parseOutputSpec(
  kind: string | null | undefined,
  frames: unknown,
  frameMs: unknown,
): OutputSpec {
  const k = outputKind(kind);
  if (k !== "gif") return { kind: k };
  const f = Number(frames);
  const ms = Number(frameMs);
  return {
    kind: "gif",
    frames: (GIF_FRAME_OPTIONS as readonly number[]).includes(f) ? f : GIF_DEFAULT_FRAMES,
    frameMs: GIF_SPEED_OPTIONS.some((s) => s.frameMs === ms) ? ms : GIF_DEFAULT_FRAME_MS,
  };
}

/** A stored output's kind, from its file extension (no schema change needed). */
export function outputKindFromUrl(url: string): OutputKind {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".gif")) return "gif";
  if (path.endsWith(".svg")) return "svg";
  return "image";
}

// The whole GIF sheet (every frame tiled into one image) must fit the request
// pixel budget. Measured 2026-11-05: 9 frames at 1024px (a 3072px sheet) is
// refused, 16 at 512px is accepted. Aim each frame at this share of the
// standard (non-experimental) budget so the first request normally fits.
const GIF_SHEET_TARGET_PIXELS = 3_686_400;
const GIF_MAX_FRAME_PIXELS = 1024 * 1024;
const GIF_MIN_FRAME_EDGE = 256;

/** Smallest grid OpenAI tiles `frames` into, as measured (4 and 6 use 4x2). */
function gifSheetCells(frames: number): number {
  if (frames <= 2) return 2;
  if (frames <= 8) return 8;
  const side = Math.ceil(Math.sqrt(frames));
  return side * side;
}

/**
 * Per-frame size for a GIF at this aspect ratio. `shrink` (0..1] scales the
 * pixel target down for a retry after OpenAI says no sheet fits.
 */
export function gifFrameSize(
  aspectRatio: `${number}:${number}`,
  frames: number,
  shrink = 1,
): `${number}x${number}` {
  const [w0, h0] = aspectRatio.split(":").map(Number);
  const r = Math.min(Math.max(h0 > 0 ? w0 / h0 : 1, 1 / 3), 3);
  const pixels =
    Math.min(GIF_SHEET_TARGET_PIXELS / gifSheetCells(frames), GIF_MAX_FRAME_PIXELS) * shrink;
  const step = (px: number) => Math.max(GIF_MIN_FRAME_EDGE, Math.floor(px / 16) * 16);
  const h = step(Math.sqrt(pixels / r));
  const w = step(h * r);
  return `${w}x${h}`;
}

/**
 * OpenAI documents its SVGs as static (no scripts, no external resources), but
 * the file is served from our bucket and opened in browsers, so refuse anything
 * that could run code rather than trusting that promise.
 */
export function isSafeSvg(svg: string): boolean {
  if (!/<svg[\s>]/i.test(svg)) return false;
  return !/<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|<!ENTITY/i.test(
    svg,
  );
}
