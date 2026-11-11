// Download formats offered in the image studio. Client-safe: the studio imports
// the list for its picker, the download route imports it to validate.
import { outputKindFromUrl, type OutputKind } from "@/lib/image-output";

export const DOWNLOAD_FORMATS = [
  { id: "webp", label: "WebP", ext: "webp", mediaType: "image/webp" },
  { id: "jpg", label: "JPG", ext: "jpg", mediaType: "image/jpeg" },
  { id: "png", label: "PNG", ext: "png", mediaType: "image/png" },
  { id: "gif", label: "GIF (original)", ext: "gif", mediaType: "image/gif" },
  { id: "svg", label: "SVG (original)", ext: "svg", mediaType: "image/svg+xml" },
] as const;

export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number]["id"];

// Which formats make sense for each kind of output. A GIF keeps its animation
// as GIF or animated WebP (smaller, and the CMS takes both); flattening it to
// JPG would lose the point. An SVG offers itself plus a PNG raster.
const FORMATS_BY_KIND: Record<OutputKind, readonly DownloadFormat[]> = {
  image: ["webp", "jpg", "png"],
  gif: ["gif", "webp"],
  svg: ["svg", "png"],
};

/** The download formats offered for a stored output. */
export function downloadFormatsFor(url: string) {
  return FORMATS_BY_KIND[outputKindFromUrl(url)].map((id) => downloadFormat(id)!);
}

/** Whether this output can be downloaded in this format. */
export function canDownloadAs(url: string, format: DownloadFormat): boolean {
  return FORMATS_BY_KIND[outputKindFromUrl(url)].includes(format);
}

export function downloadFormat(id: string | null | undefined) {
  return DOWNLOAD_FORMATS.find((f) => f.id === id);
}

/**
 * A filename the operator can keep: lowercase words joined by hyphens, never
 * empty, never a path. The extension is added from the format, not trusted
 * from the caller.
 */
export function downloadFilename(base: string, format: DownloadFormat): string {
  const slug =
    base
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // drop the accents NFKD split off
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "image";
  return `${slug}.${downloadFormat(format)!.ext}`;
}

/** The studio link for one output, in the chosen format. */
export function downloadHref(url: string, format: DownloadFormat, name: string) {
  const q = new URLSearchParams({ url, format, name });
  return `/api/images/download?${q.toString()}`;
}
