export type Platform = {
  id: string;
  label: string;
  aspectRatio: `${number}:${number}`;
  /** Exact output pixels, set only for custom sizes. Presets leave it to the model. */
  size?: { width: number; height: number };
};

// Preset social/ad formats. aspectRatio is passed to the image model; exact
// pixel cropping is left to the user / downstream tools in v1.
export const PLATFORMS: Platform[] = [
  { id: "ig-post", label: "Instagram post (1:1)", aspectRatio: "1:1" },
  { id: "ig-portrait", label: "Instagram portrait (4:5)", aspectRatio: "4:5" },
  { id: "ig-story", label: "IG / Reel / TikTok story (9:16)", aspectRatio: "9:16" },
  { id: "fb-feed", label: "Facebook feed (1.91:1)", aspectRatio: "1911:1000" },
  { id: "landscape", label: "Landscape / YouTube (16:9)", aspectRatio: "16:9" },
  { id: "pinterest", label: "Pinterest (2:3)", aspectRatio: "2:3" },
];

export const PLATFORM_MAP = new Map(PLATFORMS.map((p) => [p.id, p]));

// Custom sizes travel as a platform id, `custom-1200x628`, so they need no new
// column: the generation row, the output records and the history page all key
// on the platform id already. The bounds are GPT Image 2.5's, which renders the
// shape natively; the other models are cropped to it (see image-models.ts).
export const CUSTOM_MIN_EDGE = 256;
export const CUSTOM_MAX_EDGE = 3840;
export const CUSTOM_MAX_RATIO = 3;

/** Why a custom width x height is unusable, or null when it is fine. */
export function customSizeError(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return "Width and height must be whole pixels.";
  }
  if (
    width < CUSTOM_MIN_EDGE ||
    height < CUSTOM_MIN_EDGE ||
    width > CUSTOM_MAX_EDGE ||
    height > CUSTOM_MAX_EDGE
  ) {
    return `Each side must be ${CUSTOM_MIN_EDGE} to ${CUSTOM_MAX_EDGE}px.`;
  }
  if (Math.max(width, height) / Math.min(width, height) > CUSTOM_MAX_RATIO) {
    return `The long side can be at most ${CUSTOM_MAX_RATIO}x the short side.`;
  }
  return null;
}

export function customPlatformId(width: number, height: number): string {
  return `custom-${width}x${height}`;
}

function parseCustom(id: string): Platform | null {
  const m = /^custom-(\d{1,4})x(\d{1,4})$/.exec(id);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (customSizeError(width, height)) return null;
  return {
    id,
    label: `Custom (${width} × ${height})`,
    aspectRatio: `${width}:${height}`,
    size: { width, height },
  };
}

/** A preset or a valid custom size, or undefined for anything else. */
export function resolvePlatform(id: string): Platform | undefined {
  return PLATFORM_MAP.get(id) ?? parseCustom(id) ?? undefined;
}

export function platformLabel(id: string): string {
  return resolvePlatform(id)?.label ?? id;
}
