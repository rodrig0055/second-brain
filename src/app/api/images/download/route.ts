import sharp from "sharp";
import { accessErrorResponse, apiUser } from "@/lib/access";
import { canDownloadAs, downloadFilename, downloadFormat } from "@/lib/image-download";
import { isOwnS3Url, isVercelBlobUrl } from "@/lib/storage";
import { attachmentDisposition } from "@/lib/storage/s3";

export const maxDuration = 60;

/**
 * Only generated studio images, and only from our own storage. The URL comes
 * from the query string, so without this the route would fetch anything.
 */
function isGeneratedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!isOwnS3Url(raw) && !isVercelBlobUrl(raw)) return false;
  return url.pathname.split("/").includes("generated");
}

/**
 * Download a studio output as a file, converted to the chosen format.
 *
 * Two reasons this is a route rather than a plain link. The images live on
 * another origin (R2), where the browser ignores `<a download>` and just opens
 * the image in a tab. And the models all write PNG, so WebP and JPG have to be
 * made from it, which sharp does here with the same result in every browser
 * (canvas WebP encoding is not reliable in Safari).
 */
export async function GET(req: Request) {
  try {
    await apiUser();
    const params = new URL(req.url).searchParams;
    const src = params.get("url") ?? "";
    const format = downloadFormat(params.get("format"));
    if (!format || !isGeneratedImageUrl(src) || !canDownloadAs(src, format.id)) {
      return Response.json({ error: "Unsupported image or format" }, { status: 400 });
    }

    const upstream = await fetch(src);
    if (!upstream.ok) {
      return Response.json(
        { error: `Could not read the image (${upstream.status})` },
        { status: 502 },
      );
    }
    const input = Buffer.from(await upstream.arrayBuffer());

    // GIF and SVG outputs download as themselves, byte for byte.
    const passthrough = format.id === "gif" || format.id === "svg";
    // `animated` keeps every GIF frame when re-encoding to WebP; an SVG is
    // rasterised at 2x so the PNG stays crisp at its full viewBox size.
    let image = sharp(input, { failOn: "none", animated: true, density: 144 });
    if (format.id === "webp") image = image.webp({ quality: 90 });
    else if (format.id === "jpg") {
      // JPG has no alpha: flatten onto white rather than letting it go black.
      image = image.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true });
    } else image = image.png();

    const out = passthrough ? input : await image.toBuffer();
    return new Response(new Uint8Array(out), {
      headers: {
        "Content-Type": format.mediaType,
        "Content-Length": String(out.length),
        "Content-Disposition": attachmentDisposition(
          downloadFilename(params.get("name") ?? "", format.id),
        ),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("image download error", err);
    return Response.json({ error: "Download failed" }, { status: 500 });
  }
}
