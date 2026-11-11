import { del, put } from "@vercel/blob";
import type { PutBody, PutOptions, StoredObject } from "./index";

/**
 * The live backend. Requires BLOB_READ_WRITE_TOKEN, which Vercel injects.
 *
 * Everything here is a thin pass-through: this file should stay boring so that
 * the S3 backend beside it is easy to compare against.
 */

export async function blobPut(
  key: string,
  body: PutBody,
  opts: PutOptions = {},
): Promise<StoredObject> {
  const blob = await put(key, body, {
    access: "public",
    ...(opts.contentType ? { contentType: opts.contentType } : {}),
  });
  return { url: blob.url };
}

/**
 * `del()` takes URLs rather than keys, and ignores anything already gone, so
 * this is safe to re-run.
 */
export async function blobDelete(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await del(urls);
}
