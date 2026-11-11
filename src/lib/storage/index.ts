/**
 * Object storage, with the provider kept behind this seam.
 *
 * S3 is the live backend (STORAGE_BACKEND=s3) since 2026-09-24, when the Vercel
 * Blob store passed the Hobby 1 GB cap and Vercel blocked it for reads as well
 * as writes. With STORAGE_BACKEND unset every call still lands on @vercel/blob,
 * which is what local dev without AWS credentials gets.
 *
 * Two things about this design are deliberate.
 *
 * 1. `deleteObjects` routes by URL, not by the configured backend. The database
 *    stores absolute URLs, so rows written by Blob and rows written by S3 can
 *    coexist indefinitely. Deleting by "whatever backend is configured today"
 *    would silently fail to remove older objects, and would keep failing quietly
 *    because nothing checks. Routing on the hostname means a switch needs no
 *    data migration to stay correct.
 *
 * 2. Keys, not URLs, are the input to writes. `@vercel/blob`'s `del()` happens
 *    to accept URLs while S3 needs keys, so the URL-to-key translation lives in
 *    each backend rather than leaking into routes. This is the single most
 *    common way a storage port breaks deletion.
 *
 * Both backends load through dynamic imports, so the unused one never
 * initialises.
 *
 * NOT covered here: the browser's direct-to-storage upload for customsong. It is
 * a provider-specific handshake rather than a function call, so it lives in
 * src/app/api/customsong/upload/route.ts (which answers with either a Vercel
 * Blob token or an S3 presigned POST) and src/lib/storage/browser-upload.ts.
 */

export type PutBody =
  | string
  | Blob
  | ArrayBuffer
  | Buffer
  | ReadableStream
  | File;

export type PutOptions = {
  contentType?: string;
  /**
   * Serve the object as a download under this name. S3 only: Vercel Blob gets
   * the same effect from `?download=1` on the URL (see blob-download.ts), and
   * S3 ignores that parameter, so the header has to be set when writing.
   */
  downloadName?: string;
};
export type StoredObject = { url: string };
export type StorageBackend = "vercel-blob" | "s3";

function backend(): StorageBackend {
  return process.env.STORAGE_BACKEND === "s3" ? "s3" : "vercel-blob";
}

/** Which backend new writes land on. Reads and deletes are routed per URL. */
export function storageBackend(): StorageBackend {
  return backend();
}

/**
 * Store an object under `key` and return its public URL.
 *
 * `key` is a path, never a URL: `brand-assets/<uuid>-<name>`. Callers keep
 * owning the key layout, since it is meaningful (it groups by feature and is
 * visible in the public URL).
 */
export async function putObject(
  key: string,
  body: PutBody,
  opts: PutOptions = {},
): Promise<StoredObject> {
  if (backend() === "s3") {
    const { s3Put } = await import("./s3");
    return s3Put(key, body, opts);
  }
  const { blobPut } = await import("./vercel-blob");
  return blobPut(key, body, opts);
}

/**
 * Delete objects by their stored public URLs.
 *
 * Tolerant on purpose. Each URL goes to the backend that owns its hostname, and
 * anything unrecognised is skipped with a warning rather than throwing: a stale
 * or foreign URL on one row must not turn a delete request into a 500 and leave
 * the caller's own row undeleted.
 */
export async function deleteObjects(urls: string[]): Promise<void> {
  const blobUrls: string[] = [];
  const s3Urls: string[] = [];

  for (const url of urls) {
    if (isVercelBlobUrl(url)) blobUrls.push(url);
    else if (isOwnS3Url(url)) s3Urls.push(url);
    else console.warn(`storage: skipping unrecognised URL, not ours: ${url}`);
  }

  await Promise.all([
    blobUrls.length
      ? import("./vercel-blob").then((m) => m.blobDelete(blobUrls))
      : Promise.resolve(),
    s3Urls.length
      ? import("./s3").then((m) => m.s3Delete(s3Urls))
      : Promise.resolve(),
  ]);
}

/** Vercel Blob public URLs look like https://<id>.public.blob.vercel-storage.com/<key> */
export function isVercelBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * True when the URL sits under our own S3/CDN origin. Requires
 * STORAGE_PUBLIC_BASE_URL to be set, so with S3 unconfigured this is always
 * false and every URL routes to Blob.
 */
export function isOwnS3Url(url: string): boolean {
  const base = process.env.STORAGE_PUBLIC_BASE_URL;
  if (!base) return false;
  return url.startsWith(base.replace(/\/+$/, "") + "/");
}
