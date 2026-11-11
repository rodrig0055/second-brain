import type { PutBody, PutOptions, StoredObject } from "./index";

/**
 * S3-API backend, pointed at Cloudflare R2 (bucket `second-brain-media`). Live
 * since 2026-09-24, when the Vercel Blob store passed the Hobby 1 GB cap and
 * Vercel blocked it for reads as well as writes.
 *
 * R2 was chosen over AWS S3 because serving is free on R2, and these objects
 * are embedded in storefront pages and newsletters, so egress is the cost that
 * grows. Nothing here is R2-specific beyond the endpoint, so AWS S3 works by
 * leaving STORAGE_ENDPOINT unset.
 *
 * Activation needs no code change:
 *   STORAGE_BACKEND=s3
 *   STORAGE_BUCKET, STORAGE_PUBLIC_BASE_URL
 *   STORAGE_ENDPOINT (R2: https://<account>.r2.cloudflarestorage.com)
 *   STORAGE_REGION (R2: "auto", the default)
 *   STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY
 * The credentials are not named AWS_*, which Vercel reserves for its runtime.
 * With them unset the SDK's default chain applies (an AWS profile locally).
 *
 * The SDK is loaded with a dynamic import rather than a top-level one so the
 * Vercel Blob path never pays to initialise it.
 */

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBase: string;
};

function config(): S3Config {
  const bucket = process.env.STORAGE_BUCKET;
  const publicBase = process.env.STORAGE_PUBLIC_BASE_URL;
  if (!bucket || !publicBase) {
    throw new Error(
      "storage: STORAGE_BACKEND=s3 requires STORAGE_BUCKET and STORAGE_PUBLIC_BASE_URL",
    );
  }
  return {
    bucket,
    region: process.env.STORAGE_REGION || "auto",
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    publicBase: publicBase.replace(/\/+$/, ""),
  };
}

// Cached across invocations so a warm instance reuses one client, matching how
// src/lib/fs-db/client.ts holds its pool.
let cached: import("@aws-sdk/client-s3").S3Client | null = null;

async function client() {
  if (cached) return cached;
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { region, endpoint } = config();
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  cached = new S3Client({
    region,
    endpoint,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
    // The SDK now adds CRC32 checksums to every request by default. A presigned
    // URL would then carry the checksum of an empty body, and the browser's real
    // upload would fail signature checks. Only send them when an API needs one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return cached;
}

/**
 * A key as it appears in a URL. Keys carry operator filenames with spaces and
 * brackets (`photo_2026-09-22 (2).jpg`), so each segment is encoded while the
 * slashes that make the folders are kept. urlToKey reverses it.
 */
export function keyToUrlPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** The key behind one of our public URLs, or null when the URL is not ours. */
export function urlToKey(url: string, publicBase: string): string | null {
  const base = publicBase.replace(/\/+$/, "") + "/";
  if (!url.startsWith(base)) return null;
  const path = url.slice(base.length).split(/[?#]/)[0].replace(/^\/+/, "");
  if (!path) return null;
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** `attachment` with the name the operator will see, safe for any filename. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Every key is unique (a uuid, a generation id, a timestamp or a random suffix
// is in it), so an object never changes once written and can be cached for good.
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Normalise the body types the call sites actually pass: `File` from form
 * uploads, `Buffer` from generated images. The S3 SDK does not accept a web
 * `File`, so the conversion lives here rather than at each call site.
 */
async function toBody(body: PutBody): Promise<string | Uint8Array> {
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (body instanceof ReadableStream) {
    const chunks: Buffer[] = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("storage: unsupported body type for the S3 backend");
}

export async function s3Put(
  key: string,
  body: PutBody,
  opts: PutOptions = {},
): Promise<StoredObject> {
  const { bucket, publicBase } = config();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = await client();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: await toBody(body),
      CacheControl: IMMUTABLE,
      ...(opts.contentType ? { ContentType: opts.contentType } : {}),
      ...(opts.downloadName
        ? { ContentDisposition: attachmentDisposition(opts.downloadName) }
        : {}),
    }),
  );

  return { url: `${publicBase}/${keyToUrlPath(key)}` };
}

/**
 * Delete by public URL, translating each back to a key.
 *
 * This translation is the reason the wrapper exists at all. Vercel Blob's
 * `del()` takes URLs, S3 takes keys, and the database only ever stored URLs.
 * Doing it per call site is how a storage port ends up deleting nothing while
 * reporting success.
 */
export async function s3Delete(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const { bucket, publicBase } = config();
  const { DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const s3 = await client();

  const keys = urls
    .map((u) => urlToKey(u, publicBase))
    .filter((k): k is string => !!k)
    .map((Key) => ({ Key }));

  if (keys.length === 0) return;

  // DeleteObjects caps at 1000 keys per request.
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000), Quiet: true },
      }),
    );
  }
}

/**
 * A short-lived URL the browser PUTs one file to, straight into the bucket.
 *
 * This is how customsong uploads skip the 4.5 MB function body cap. R2 has no
 * presigned POST, so the size cap cannot be signed into the request: the route
 * checks the declared size before signing, and the bucket accepts at most what
 * one PUT carries. The headers returned here are signed, so the browser must
 * send exactly them.
 */
export async function s3PresignPut(
  key: string,
  opts: { contentType: string; downloadName?: string; expiresIn?: number },
): Promise<{ uploadUrl: string; headers: Record<string, string>; url: string }> {
  const { bucket, publicBase } = config();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const s3 = await client();

  const headers: Record<string, string> = {
    "content-type": opts.contentType,
    "cache-control": IMMUTABLE,
  };
  if (opts.downloadName) {
    headers["content-disposition"] = attachmentDisposition(opts.downloadName);
  }

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: headers["content-type"],
      CacheControl: headers["cache-control"],
      ContentDisposition: headers["content-disposition"],
    }),
    {
      expiresIn: opts.expiresIn ?? 15 * 60,
      signableHeaders: new Set(Object.keys(headers)),
    },
  );

  return { uploadUrl, headers, url: `${publicBase}/${keyToUrlPath(key)}` };
}
