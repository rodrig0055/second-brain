/**
 * Email-safe image derivatives.
 *
 * The storefront feed's `image_link` is the full-size original: the 13 photos
 * on a typical SG brief total 14.4MB, the largest single file 5.07MB, and every
 * one is WebP. Neither is usable in an email -- Gmail does not render WebP, and
 * no subscriber should download megabytes of originals. The S3 path exposes no
 * derivatives either (350_/250_ prefixes and .jpg all 403), so the resize has
 * to happen here.
 *
 * The encode is pure (`deriveBuffer`); where the bytes land is the caller's
 * choice, because the app writes to blob storage and the offline comparison
 * harness writes to disk.
 */
import sharp from "sharp";
import { createHash } from "node:crypto";

export type Derived = { key: string; buffer: Buffer; bytes: number; sourceBytes: number };

/** Stable identity for a derivative: same source and size means same file. */
export function derivativeKey(url: string, displayWidth: number): string {
  return `p_${createHash("sha1").update(url).digest("hex").slice(0, 12)}_${displayWidth}.jpg`;
}

/**
 * Fetch the original, with retries.
 *
 * The asset bucket is measurably unreliable: fetches of the same URL have come
 * back in 0.4s, in 12s, and timed out entirely within the same session. A
 * single flaky response must not fail a render a marketer is waiting on, so
 * each attempt gets its own timeout and a short backoff.
 */
async function fetchWithRetry(url: string, attempts = 3): Promise<Buffer> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`returned ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(
    `image ${url} failed after ${attempts} attempts: ${last instanceof Error ? last.message : String(last)}`,
  );
}

/**
 * Fetch, resize to `displayWidth` at 2x, encode progressive JPEG on the tile
 * background. Product shots are transparent-edged WebP, so flattening avoids
 * black boxes in clients that ignore alpha.
 */
export async function deriveBuffer(
  url: string,
  displayWidth: number,
  background = "#F1F2F6",
): Promise<Derived> {
  const src = await fetchWithRetry(url);

  const buffer = await sharp(src)
    .resize({ width: displayWidth * 2, withoutEnlargement: true })
    .flatten({ background })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();

  return {
    key: derivativeKey(url, displayWidth),
    buffer,
    bytes: buffer.length,
    sourceBytes: src.length,
  };
}

/**
 * Derive many through a small pool, so one 5MB original cannot stall the rest.
 * `sink` persists the bytes and returns the public URL.
 */
export async function deriveAll(
  jobs: Array<{ name: string; url: string; width: number }>,
  sink: (d: Derived) => Promise<string>,
): Promise<Map<string, { url: string; bytes: number; sourceBytes: number }>> {
  const out = new Map<string, { url: string; bytes: number; sourceBytes: number }>();
  const queue = [...jobs];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const d = await deriveBuffer(job.url, job.width);
      out.set(job.name, { url: await sink(d), bytes: d.bytes, sourceBytes: d.sourceBytes });
    }
  });
  await Promise.all(workers);
  return out;
}
