import "server-only";

import sharp from "sharp";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { brandAssets, imageGenerations } from "@/db/schema";
import { isOwnS3Url, isVercelBlobUrl, putObject } from "@/lib/storage";

/**
 * Getting an image into a shape Meta will accept.
 *
 * Instagram only takes JPEG for an image container, and the Image Studio writes
 * PNG. So a picture someone generated in this app cannot be posted from this
 * app without a conversion — which is why the studio and the queue were never
 * actually connected before. Everything that goes into a draft comes through
 * here, and comes out a public JPEG URL.
 */

export type NormalizedImage = {
  url: string;
  width: number;
  height: number;
  bytes: number;
};

/** The largest Instagram uses. Anything bigger is bandwidth for nobody. */
const MAX_WIDTH = 1440;

export async function normalizeImageForSocial(
  input: Buffer | Uint8Array,
  brandId: string,
): Promise<NormalizedImage> {
  const pipeline = sharp(input)
    // Honour the EXIF orientation, then drop it: Meta ignores the tag, so a
    // phone photo would arrive on its side.
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const key = `social/${brandId}/${crypto.randomUUID()}.jpg`;
  const stored = await putObject(key, data, { contentType: "image/jpeg" });

  return { url: stored.url, width: info.width, height: info.height, bytes: data.length };
}

/** Fetch a URL and normalise it, for a picked studio image or a pasted link. */
export async function normalizeImageFromUrl(
  url: string,
  brandId: string,
): Promise<NormalizedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch that image (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return normalizeImageForSocial(buf, brandId);
}

/** Dimensions without converting, for warning about an aspect ratio. */
export async function measureImage(
  input: Buffer | Uint8Array,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

export type PickerItem = {
  url: string;
  label: string;
  source: "studio" | "asset";
  createdAt: Date;
};

/**
 * What a person can pick from instead of uploading: images this app already
 * made for this brand, and the brand's stored assets.
 */
export async function loadPickerMedia(brandId: string, limit = 60): Promise<PickerItem[]> {
  const [generations, assets] = await Promise.all([
    db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.brandId, brandId), eq(imageGenerations.status, "done")))
      .orderBy(desc(imageGenerations.createdAt))
      .limit(limit),
    db
      .select()
      .from(brandAssets)
      .where(eq(brandAssets.brandId, brandId))
      .orderBy(desc(brandAssets.createdAt))
      .limit(limit),
  ]);

  const items: PickerItem[] = [];
  for (const gen of generations) {
    for (const output of gen.outputs ?? []) {
      if (!output.url) continue;
      items.push({
        url: output.url,
        label: gen.brief.slice(0, 60) || output.platform || "Generated image",
        source: "studio",
        createdAt: gen.createdAt,
      });
    }
  }
  for (const asset of assets) {
    if (!asset.url) continue;
    items.push({
      url: asset.url,
      label: asset.label || "Brand asset",
      source: "asset",
      createdAt: asset.createdAt,
    });
  }

  return items
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/** Only our own storage, or a brand's own stored media, may be pulled in. */
export async function isOwnMediaUrl(url: string, brandId: string): Promise<boolean> {
  if (isVercelBlobUrl(url) || isOwnS3Url(url)) return true;
  const picker = await loadPickerMedia(brandId, 200);
  return picker.some((p) => p.url === url);
}
