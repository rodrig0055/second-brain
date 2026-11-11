import { apiBrand, apiUser, accessErrorResponse } from "@/lib/access";
import { measureImage, normalizeImageForSocial } from "@/lib/social/media";

/**
 * Take an image someone picked and hand back a URL Meta can fetch.
 *
 * A server action would be simpler, but they cap request bodies at 1 MB and a
 * phone photo is bigger than that. Video does not come through here at all: it
 * goes straight to Blob storage from the browser, because a function body caps
 * at 4.5 MB either way.
 */
export const maxDuration = 60;

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  try {
    await apiUser();
    const form = await req.formData();
    const brandId = String(form.get("brandId") ?? "");
    await apiBrand(brandId);

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return Response.json({ error: "No files were sent." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return Response.json({ error: `At most ${MAX_FILES} images at a time.` }, { status: 400 });
    }

    const out = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return Response.json(
          { error: `${file.name} is not an image. Video uploads use the direct path.` },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES) {
        return Response.json(
          { error: `${file.name} is ${(file.size / 1e6).toFixed(1)} MB; the limit is 25 MB.` },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const original = await measureImage(buf).catch(() => ({ width: 0, height: 0 }));
      const stored = await normalizeImageForSocial(buf, brandId);
      out.push({ ...stored, originalWidth: original.width, originalHeight: original.height });
    }

    return Response.json({ media: out });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    return Response.json(
      { error: `Could not prepare that image: ${(err as Error)?.message ?? "unknown error"}` },
      { status: 400 },
    );
  }
}
