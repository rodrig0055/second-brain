import "server-only";

import { putObject } from "@/lib/storage";

/**
 * Copies of creative images that do not expire.
 *
 * Meta hands back `fbcdn.net` URLs signed with an expiry (`oe=`), and they
 * start answering 403 within days. Stored as-is, every thumbnail in the ads
 * workspace went blank shortly after it was synced. So the image is copied to
 * our own storage at write time and the copy's URL is what the row keeps.
 *
 * Failure is soft: if the copy fails, the fresh Meta URL is kept, which works
 * until it expires, and the next refresh tries the copy again.
 */

const KEY_PREFIX = "ad-creatives";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** A signed Meta CDN URL, the kind that expires. */
export function isExpiringMetaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function copyImage(url: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = EXT[type];
    if (!ext) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;
    const stored = await putObject(`${key}.${ext}`, body, { contentType: type });
    return stored.url;
  } catch {
    return null;
  }
}

/**
 * The image and thumbnail URLs to store for an ad.
 *
 * `existing` is what the row holds now. A copy already made is kept rather
 * than made again, since an ad's creative does not change once it is live.
 */
export async function durableCreativeMedia(
  connectionId: string,
  adId: string,
  fresh: { imageUrl: string | null; thumbnailUrl: string | null },
  existing?: { imageUrl: string | null; thumbnailUrl: string | null },
): Promise<{ imageUrl: string | null; thumbnailUrl: string | null }> {
  const pick = async (
    freshUrl: string | null,
    existingUrl: string | null | undefined,
    kind: "image" | "thumb",
  ): Promise<string | null> => {
    if (existingUrl && !isExpiringMetaUrl(existingUrl)) return existingUrl;
    if (!isExpiringMetaUrl(freshUrl)) return freshUrl;
    const copied = await copyImage(freshUrl!, `${KEY_PREFIX}/${connectionId}/${adId}-${kind}`);
    return copied ?? freshUrl;
  };

  const [imageUrl, thumbnailUrl] = await Promise.all([
    pick(fresh.imageUrl, existing?.imageUrl, "image"),
    pick(fresh.thumbnailUrl, existing?.thumbnailUrl, "thumb"),
  ]);
  return { imageUrl, thumbnailUrl };
}
