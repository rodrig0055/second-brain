import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { apiUser, accessErrorResponse } from "@/lib/access";
import { storageBackend } from "@/lib/storage";
import {
  isPresignRequest,
  planUpload,
  SOCIAL_VIDEO_UPLOADS,
} from "@/lib/storage/browser-upload-plan";

/**
 * Direct-to-storage upload for social video.
 *
 * A Reel is tens of megabytes and a Vercel function body caps at 4.5 MB, so the
 * browser uploads straight to storage and only the resulting public URL comes
 * back to us. Meta fetches that URL itself, which is why it has to be public.
 *
 * Same two protocols as the Custom Song upload route, chosen by the configured
 * backend: on S3/R2 the browser gets a presigned PUT, otherwise the
 * @vercel/blob/client handshake runs. The browser half is
 * src/lib/storage/browser-upload.ts.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await apiUser();
    const body = (await req.json()) as unknown;

    if (isPresignRequest(body)) {
      if (storageBackend() !== "s3") return Response.json({ mode: "vercel-blob" });
      const plan = planUpload(body, undefined, SOCIAL_VIDEO_UPLOADS);
      if ("error" in plan) return Response.json({ error: plan.error }, { status: 400 });
      const { s3PresignPut } = await import("@/lib/storage/s3");
      // No downloadName: the video is played inline in the preview and fetched
      // by Meta, never downloaded as an attachment.
      const signed = await s3PresignPut(plan.key, { contentType: plan.contentType });
      return Response.json({ mode: "s3", ...signed });
    }

    const json = await handleUpload({
      body: body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...SOCIAL_VIDEO_UPLOADS.contentTypes],
        addRandomSuffix: true,
        maximumSizeInBytes: SOCIAL_VIDEO_UPLOADS.maxBytes,
      }),
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    return Response.json(
      { error: `Could not prepare the upload: ${(err as Error)?.message ?? "unknown error"}` },
      { status: 400 },
    );
  }
}
