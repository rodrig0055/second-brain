import { Button } from "@astryxdesign/core/Button";
import { downloadFormatsFor, downloadHref } from "@/lib/image-download";

/**
 * One-click downloads of a generated image, one link per format. No client
 * state, so it renders the same from the studio and the server-rendered
 * history page. The route sets `Content-Disposition: attachment`, so the file
 * saves instead of opening a tab.
 */
export function ImageDownloadLinks({ url, name }: { url: string; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-zinc-500">Download</span>
      {downloadFormatsFor(url).map((f) => (
        <Button
          key={f.id}
          href={downloadHref(url, f.id, name)}
          label={f.ext.toUpperCase()}
          size="sm"
          tooltip={`Download as ${f.label}`}
          // A download route, not a page: the browser saves it, and the Link must not prefetch it.
          {...({ download: true, prefetch: false } as object)}
        />
      ))}
    </span>
  );
}
