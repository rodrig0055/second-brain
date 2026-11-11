import { accessErrorResponse, apiUser } from "@/lib/access";
import { scrapePage } from "@/lib/fetch-page";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await apiUser();
    const { url }: { url?: string } = await req.json();
    if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

    // One page load yields both the product imagery and the page's text
    // context (title, meta, visible copy) so the brief can be grounded in what
    // the page is actually selling — not just its pictures.
    const { ok, images, context } = await scrapePage(url);
    if (!ok) {
      return Response.json(
        { error: "Could not open that page. Check the link, or upload the image instead." },
        { status: 502 },
      );
    }
    return Response.json({ images, context });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("scrape-url error", err);
    return Response.json({ error: "Could not read that page" }, { status: 500 });
  }
}
