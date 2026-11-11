/**
 * What Meta will refuse, said in a sentence a marketer can act on.
 *
 * Pure, so Compose can run it while someone types rather than only discovering
 * the problem at publish time. The rules are Meta's, learned by hitting them:
 * the Graph errors they replace say things like "(#100) Invalid parameter",
 * which tells you nothing about which of your six URLs is the problem.
 */

import { fbScheduleProblem } from "./time";

export type DraftShape = {
  channel: "instagram" | "facebook" | "both" | "tiktok";
  mediaType: string;
  caption: string;
  mediaUrls: string[];
  linkUrl?: string | null;
  firstComment?: string | null;
  scheduledAt?: Date | null;
};

export type TargetShape = { igUserId: string };

export const CAPTION_LIMIT = 2200;
export const HASHTAG_LIMIT = 30;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

export function wantsInstagram(channel: DraftShape["channel"]): boolean {
  return channel === "instagram" || channel === "both";
}

export function wantsFacebook(channel: DraftShape["channel"]): boolean {
  return channel === "facebook" || channel === "both";
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/** Instagram only accepts JPEG for an image container. PNG fails on fetch. */
export function isJpegUrl(url: string): boolean {
  return /\.(jpe?g)(\?|$)/i.test(url);
}

export function looksLikeVideo(url: string): boolean {
  return /\.(mp4|mov)(\?|$)/i.test(url);
}

/**
 * The first blocking problem, or null. One at a time and in this order, because
 * a list of six complaints about the same missing image is noise.
 */
export function validateDraft(draft: DraftShape, target: TargetShape): string | null {
  // TikTok has its own rules (tiktok-rules.ts) and its own publisher; reaching
  // Meta's checks with one means something routed it wrong.
  if (draft.channel === "tiktok") {
    return "This is a TikTok draft; it publishes through the TikTok connection, not Meta.";
  }
  const ig = wantsInstagram(draft.channel);
  const fb = wantsFacebook(draft.channel);

  if (ig && !target.igUserId) {
    return "This connection has no Instagram account linked to the Page.";
  }
  if (ig && draft.mediaType === "text") {
    return "Instagram has no text-only post. Add an image or video, or post to Facebook only.";
  }
  if (ig && draft.mediaUrls.length === 0) {
    return "Instagram posts need at least one image or video URL.";
  }
  if (fb && !draft.caption.trim() && draft.mediaUrls.length === 0) {
    return "A Facebook post needs either a message or an image.";
  }
  if (draft.mediaType === "carousel" && draft.mediaUrls.length < CAROUSEL_MIN) {
    return `A carousel needs at least ${CAROUSEL_MIN} media URLs.`;
  }
  if (draft.mediaUrls.length > CAROUSEL_MAX) {
    return `Instagram allows at most ${CAROUSEL_MAX} items in a carousel.`;
  }

  // Meta fetches these from its own servers, so anything it cannot reach from
  // the public internet fails at container creation with an unhelpful message.
  const notHttps = draft.mediaUrls.find((u) => !/^https:\/\//i.test(u));
  if (notHttps) {
    return `Media URLs must be public https URLs. Meta fetches them itself, so "${notHttps}" will fail.`;
  }
  if (ig) {
    const notJpeg = draft.mediaUrls.find((u) => !looksLikeVideo(u) && !isJpegUrl(u));
    if (notJpeg) {
      return `Instagram only accepts JPEG images. "${notJpeg}" needs converting first.`;
    }
  }

  if (draft.caption.length > CAPTION_LIMIT) {
    return `Caption is ${draft.caption.length} characters; the limit is ${CAPTION_LIMIT}.`;
  }
  const comment = draft.firstComment ?? "";
  if (comment.length > CAPTION_LIMIT) {
    return `First comment is ${comment.length} characters; the limit is ${CAPTION_LIMIT}.`;
  }
  if (ig) {
    const tags = countHashtags(draft.caption) + countHashtags(comment);
    if (tags > HASHTAG_LIMIT) {
      return `Instagram allows ${HASHTAG_LIMIT} hashtags; this has ${tags} across the caption and first comment.`;
    }
  }

  if (draft.scheduledAt) {
    if (draft.channel === "instagram") {
      return "Instagram cannot be scheduled. Publish it now, or plan a day and post it by hand.";
    }
    const problem = fbScheduleProblem(draft.scheduledAt);
    if (problem) return problem;
  }

  return null;
}

export type DraftWarning = { field: string; message: string };

/**
 * Not blocking, but worth saying while someone is still typing. Separate from
 * the errors so the UI can show both without either drowning the other.
 */
export function draftWarnings(draft: DraftShape): DraftWarning[] {
  const out: DraftWarning[] = [];
  const ig = wantsInstagram(draft.channel);

  if (draft.caption.length > 125) {
    out.push({
      field: "caption",
      message: "Only the first 125 characters show before the fold. Lead with the hook.",
    });
  }
  const tags = countHashtags(draft.caption);
  if (ig && tags > 15) {
    out.push({
      field: "caption",
      message: `${tags} hashtags in the caption. 5-15 reads better, or move them to the first comment.`,
    });
  }
  if (wantsFacebook(draft.channel) && draft.linkUrl && draft.mediaUrls.length > 0) {
    out.push({
      field: "linkUrl",
      message: "Facebook shows either your image or the link preview, not both.",
    });
  }
  if (draft.mediaType === "video" && ig) {
    out.push({
      field: "mediaType",
      message: "Instagram publishes single videos as Reels; 9:16 performs best.",
    });
  }
  if (!draft.caption.trim() && draft.mediaUrls.length > 0) {
    out.push({ field: "caption", message: "No caption. Posts without one rarely go anywhere." });
  }
  return out;
}
