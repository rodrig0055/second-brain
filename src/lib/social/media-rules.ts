/**
 * What Instagram and Facebook accept, as numbers.
 *
 * Checked in the browser against the image someone picked, so a post that would
 * be rejected or cropped badly is caught before it is queued rather than after
 * Meta refuses the container.
 */

export type MediaKind = "image" | "video" | "unknown";

export function classifyUrl(url: string): MediaKind {
  if (/\.(mp4|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return "image";
  return "unknown";
}

/** Instagram rejects anything outside this aspect band on a feed post. */
export const IG_MIN_ASPECT = 0.8; // 4:5 portrait
export const IG_MAX_ASPECT = 1.91; // landscape
export const IG_MIN_WIDTH = 320;

export const ASPECTS = {
  square: 1,
  portrait: 4 / 5,
  story: 9 / 16,
  landscape: 1.91,
} as const;

export function aspectOf(width: number, height: number): number {
  return height > 0 ? width / height : 0;
}

/** True when an aspect is within `tolerance` of a target, e.g. 1:1. */
export function matchesAspect(aspect: number, target: number, tolerance = 0.02): boolean {
  return Math.abs(aspect - target) <= target * tolerance;
}

export function describeAspect(width: number, height: number): string {
  const a = aspectOf(width, height);
  if (matchesAspect(a, ASPECTS.square, 0.03)) return "1:1";
  if (matchesAspect(a, ASPECTS.portrait, 0.03)) return "4:5";
  if (matchesAspect(a, ASPECTS.story, 0.03)) return "9:16";
  if (matchesAspect(a, ASPECTS.landscape, 0.05)) return "1.91:1";
  return `${a.toFixed(2)}:1`;
}

export type MediaDimensions = { url: string; width: number; height: number };

/**
 * Problems with the media for this channel. Warnings, not errors: Instagram
 * crops rather than refusing most of these, and a person may want the crop.
 */
export function mediaProblems(
  channel: "instagram" | "facebook" | "both",
  mediaType: string,
  media: MediaDimensions[],
): string[] {
  const out: string[] = [];
  const ig = channel === "instagram" || channel === "both";
  if (!ig) return out;

  for (const item of media) {
    if (!item.width || !item.height) continue;
    const aspect = aspectOf(item.width, item.height);

    if (mediaType === "video") {
      if (!matchesAspect(aspect, ASPECTS.story, 0.08)) {
        out.push(`Reels are 9:16. This one is ${describeAspect(item.width, item.height)}.`);
      }
      continue;
    }
    if (aspect < IG_MIN_ASPECT || aspect > IG_MAX_ASPECT) {
      out.push(
        `Instagram crops anything outside 4:5 to 1.91:1. This one is ${describeAspect(item.width, item.height)}.`,
      );
    }
    if (item.width < IG_MIN_WIDTH) {
      out.push(`${item.width}px wide. Instagram upscales anything under ${IG_MIN_WIDTH}px.`);
    }
  }

  // A carousel with mixed aspects gets cropped to the first item's shape.
  if (mediaType === "carousel" && media.length > 1) {
    const shapes = new Set(media.filter((m) => m.width).map((m) => describeAspect(m.width, m.height)));
    if (shapes.size > 1) {
      out.push(`Carousel items are ${[...shapes].join(" and ")}. Instagram crops them all to the first.`);
    }
  }

  return [...new Set(out)];
}
