/**
 * The server's half of a direct browser upload: what may be uploaded, and under which key.
 *
 * Kept free of SDK imports so it can be unit-tested and shared with the Vercel Blob handshake,
 * which enforces the same allowlist and size cap. Shared by the Custom Song and Social upload routes.
 */

export const UPLOAD_LIMITS = {
  contentTypes: [
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "video/mp4",
    "image/jpeg",
    "image/png",
    "image/webp",
    // iPhone photos. The render job decodes them with libheif (src/lib/customsong/lyric-video.ts).
    "image/heic",
    "image/heif",
    "text/plain",
    "application/x-subrip",
    "application/octet-stream",
  ],
  maxBytes: 50 * 1024 * 1024,
} as const;

/**
 * What one upload route will accept. Each route passes its own, so a token minted for one surface
 * cannot be used to write into another's prefix.
 */
export type UploadPolicy = {
  contentTypes: readonly string[];
  maxBytes: number;
  /** Uploads are only ever authorised under this prefix, whatever the browser asks for. */
  prefix: string;
};

export const CUSTOMSONG_UPLOADS: UploadPolicy = { ...UPLOAD_LIMITS, prefix: "customsong/" };

/**
 * Social video. A Reel is tens of megabytes, and Instagram only takes MP4 or MOV. Images do not come
 * this way: they go through /api/social/media, which converts PNG to JPEG on the server.
 */
export const SOCIAL_VIDEO_UPLOADS: UploadPolicy = {
  contentTypes: ["video/mp4", "video/quicktime"],
  maxBytes: 300 * 1024 * 1024,
  prefix: "social/",
};

export type PresignRequest = { pathname: string; contentType: string; size: number };

export function isPresignRequest(body: unknown): body is PresignRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.pathname === "string" && typeof b.contentType === "string" && typeof b.size === "number";
}

export type UploadPlan =
  | { key: string; contentType: string; downloadName: string }
  | { error: string };

/**
 * Validate one requested upload and choose its key.
 *
 * A random suffix goes before the extension, as Vercel Blob's `addRandomSuffix` did: two orders can
 * upload `photo.jpg`, and one order can re-upload it after a fix, without either overwriting a file a
 * saved job still points at. The download keeps the operator's own filename.
 */
export function planUpload(
  req: PresignRequest,
  random: () => string = randomSuffix,
  policy: UploadPolicy = CUSTOMSONG_UPLOADS,
): UploadPlan {
  const contentType = req.contentType.split(";")[0].trim().toLowerCase() || "application/octet-stream";
  if (!policy.contentTypes.includes(contentType)) {
    return { error: `That file type (${contentType}) can't be uploaded here.` };
  }
  if (!Number.isFinite(req.size) || req.size <= 0) return { error: "That file is empty." };
  if (req.size > policy.maxBytes) {
    return { error: `That file is over the ${policy.maxBytes / 1024 / 1024} MB limit.` };
  }

  const raw = req.pathname.split("/");
  if (raw.includes("..")) return { error: "That upload path isn't allowed." };
  const segments = raw.filter((s) => s && s !== ".");
  const pathname = segments.join("/");
  if (!pathname.startsWith(policy.prefix) || segments.length < 2) {
    return { error: "That upload path isn't allowed." };
  }

  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const key = [...segments.slice(0, -1), `${stem}-${random()}${ext}`].join("/");
  return { key, contentType, downloadName: name };
}

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
