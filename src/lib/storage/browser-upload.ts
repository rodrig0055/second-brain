import { upload } from "@vercel/blob/client";

/**
 * Upload one file from the browser straight to storage and return its public URL.
 *
 * The route decides the protocol, because only the server knows which backend is live: on S3/R2 it
 * answers with a presigned PUT, otherwise it says `vercel-blob` and the @vercel/blob/client
 * handshake runs against the same route, exactly as before.
 */
export async function uploadFromBrowser(
  pathname: string,
  file: File,
  opts: { handleUploadUrl: string; contentType?: string },
): Promise<{ url: string }> {
  const contentType = opts.contentType || file.type || "application/octet-stream";
  const res = await fetch(opts.handleUploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname, contentType, size: file.size }),
  });
  const data = (await res.json().catch(() => null)) as
    | { mode: "s3"; uploadUrl: string; headers: Record<string, string>; url: string }
    | { mode: "vercel-blob" }
    | { error: string }
    | null;
  if (!res.ok || !data || "error" in data) {
    throw new Error((data && "error" in data && data.error) || `upload refused (${res.status})`);
  }

  if (data.mode === "vercel-blob") {
    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: opts.handleUploadUrl,
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
    });
    return { url: blob.url };
  }

  const put = await fetch(data.uploadUrl, { method: "PUT", headers: data.headers, body: file });
  if (!put.ok) throw new Error(`storage rejected ${file.name} (${put.status})`);
  return { url: data.url };
}
