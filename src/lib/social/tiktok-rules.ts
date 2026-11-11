/**
 * What TikTok's publish endpoints will refuse, said in a sentence a marketer
 * can act on. Pure, like validate.ts, so a form can run it as someone types.
 *
 * From the Accounts API references (mirrored in brain/docs/reference/tiktok/):
 *   /business/video/publish/   one .mp4/.mov/.webm, 3-600 s, >=360 px, 23-60 fps,
 *                              <=1 GB; caption <=2,200 characters, <=30 mentions.
 *   /business/photo/publish/   1-35 JPG/JPEG/WebP images (no PNG), <=1080x1920,
 *                              <=20 MB each; caption <=4,000, title <=90.
 *   Both                       media URLs must sit under a domain or URL prefix
 *                              whose ownership the developer app has verified.
 */

export type TiktokPostOptions = {
  /** "Promotional content" label: the brand promoting itself. TikTok requires it. */
  isBrandOrganic: boolean;
  /** "Paid partnership" label. Not ours to set on our own accounts. */
  isBrandedContent: boolean;
  /** "Creator labeled as AI-generated". Cannot be removed once posted. */
  isAiGenerated: boolean;
  disableComment: boolean;
  /** Upload to the account's TikTok drafts instead; a person posts it in the app. */
  uploadToDraft: boolean;
  /** Photo posts only. */
  autoAddMusic: boolean;
  /** Photo posts only, <=90 characters. */
  title: string;
};

export const DEFAULT_TIKTOK_OPTIONS: TiktokPostOptions = {
  // Every post from a brand account promotes that brand; TikTok's policy is to
  // disclose it, and leaving it off is what gets a post's reach restricted.
  isBrandOrganic: true,
  isBrandedContent: false,
  isAiGenerated: false,
  disableComment: false,
  uploadToDraft: false,
  autoAddMusic: false,
  title: "",
};

export function tiktokOptions(raw: Record<string, unknown> | null | undefined): TiktokPostOptions {
  const r = raw ?? {};
  const b = (k: keyof TiktokPostOptions) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_TIKTOK_OPTIONS[k] as boolean);
  return {
    isBrandOrganic: b("isBrandOrganic"),
    isBrandedContent: b("isBrandedContent"),
    isAiGenerated: b("isAiGenerated"),
    disableComment: b("disableComment"),
    uploadToDraft: b("uploadToDraft"),
    autoAddMusic: b("autoAddMusic"),
    title: typeof r.title === "string" ? r.title : "",
  };
}

export const TIKTOK_VIDEO_CAPTION_LIMIT = 2200;
export const TIKTOK_PHOTO_CAPTION_LIMIT = 4000;
export const TIKTOK_TITLE_LIMIT = 90;
export const TIKTOK_PHOTO_MAX = 35;
export const TIKTOK_MENTION_LIMIT = 30;
/** Per account per day via the API, shared with every other app posting there. */
export const TIKTOK_DAILY_POSTS = 15;

export function isTiktokVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

export function isTiktokPhotoUrl(url: string): boolean {
  return /\.(jpe?g|webp)(\?|$)/i.test(url);
}

function countMentions(text: string): number {
  return (text.match(/(^|\s)@[\w.]+/g) ?? []).length;
}

/** UTF-16 length, which is how TikTok counts. */
const len = (s: string) => s.length;

export type TiktokDraftShape = {
  mediaType: string;
  caption: string;
  mediaUrls: string[];
  options: TiktokPostOptions;
};

/**
 * The first blocking problem, or null.
 *
 * `verifiedPrefixes` are the URL prefixes (or `https://domain/` roots) the app
 * has proven it owns. Empty means "not configured", which is itself the
 * problem: TikTok rejects every unverified URL, so publishing cannot work yet.
 * Null skips the check, for saving a draft whose media is not final.
 */
export function validateTiktokDraft(
  d: TiktokDraftShape,
  verifiedPrefixes: string[] | null,
): string | null {
  if (d.mediaType === "text") {
    return "TikTok has no text-only post. Add a video or images.";
  }
  if (d.mediaUrls.length === 0) {
    return "A TikTok post needs a video or at least one image.";
  }
  const video = d.mediaType === "video";
  if (video) {
    if (d.mediaUrls.length !== 1) return "A TikTok video post takes exactly one video.";
    if (!isTiktokVideoUrl(d.mediaUrls[0])) {
      return "TikTok videos must be .mp4, .mov or .webm.";
    }
  } else {
    if (d.mediaUrls.length > TIKTOK_PHOTO_MAX) {
      return `A TikTok photo post takes at most ${TIKTOK_PHOTO_MAX} images.`;
    }
    const bad = d.mediaUrls.find((u) => !isTiktokPhotoUrl(u));
    if (bad) {
      return "TikTok photo posts take JPG or WebP only, not PNG. Re-upload the image through Compose, which converts it.";
    }
  }

  const limit = video ? TIKTOK_VIDEO_CAPTION_LIMIT : TIKTOK_PHOTO_CAPTION_LIMIT;
  if (len(d.caption) > limit) {
    return `TikTok captions are at most ${limit} characters for a ${video ? "video" : "photo"} post (this one is ${len(d.caption)}).`;
  }
  if (countMentions(d.caption) > TIKTOK_MENTION_LIMIT) {
    return `TikTok allows at most ${TIKTOK_MENTION_LIMIT} @mentions in a caption.`;
  }
  if (!video && len(d.options.title) > TIKTOK_TITLE_LIMIT) {
    return `TikTok photo titles are at most ${TIKTOK_TITLE_LIMIT} characters.`;
  }
  if (verifiedPrefixes === null) return null;
  if (verifiedPrefixes.length === 0) {
    return "TikTok only publishes media from a verified URL. Run scripts/tiktok-verify-media-prefix.ts and set TIKTOK_MEDIA_PREFIXES.";
  }
  const unverified = d.mediaUrls.find((u) => !verifiedPrefixes.some((p) => u.startsWith(p)));
  if (unverified) {
    return `TikTok will refuse ${unverified}: it is not under a verified URL prefix (${verifiedPrefixes.join(", ")}). Upload it through Compose so it lands there.`;
  }
  return null;
}

/** Prefixes from TIKTOK_MEDIA_PREFIXES (comma-separated), each ending in "/". */
export function verifiedMediaPrefixes(raw = process.env.TIKTOK_MEDIA_PREFIXES ?? ""): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.endsWith("/") ? p : `${p}/`));
}

/** The public link for a published post. TikTok accepts any handle in the path. */
export function tiktokPermalink(username: string, postId: string, mediaType: string): string {
  const kind = mediaType === "video" ? "video" : "photo";
  return `https://www.tiktok.com/@${username || "_"}/${kind}/${postId}`;
}
