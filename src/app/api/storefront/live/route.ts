import { accessErrorResponse, apiBrand } from "@/lib/access";
import { scrapeRawHtml } from "@/lib/fetch-page";
import { parseFeed, parseSitemap } from "@/lib/storefront/parse";
import { feedUrl, sitemapUrl } from "@/lib/storefront/urls";

export const maxDuration = 300;

// Fetch the LATEST storefront data live (no DB write). Backs the dashboard's
// "current" view — always the freshest sitemap + feed straight from the site.
export async function POST(req: Request) {
  try {
    const { brandId } = (await req.json()) as { brandId?: string };
    if (!brandId) {
      return Response.json({ error: "Missing brandId" }, { status: 400 });
    }
    const { brand } = await apiBrand(brandId);

    const smUrl = sitemapUrl(brand.domain);
    const fdUrl = feedUrl(brand.domain);
    const [smXml, fdXml] = await Promise.all([
      scrapeRawHtml(smUrl),
      scrapeRawHtml(fdUrl),
    ]);

    const urls = smXml ? parseSitemap(smXml) : [];
    const products = fdXml ? parseFeed(fdXml) : [];

    const byType: Record<string, number> = {};
    for (const u of urls) byType[u.type] = (byType[u.type] ?? 0) + 1;

    const inStock = products.filter(
      (p) => p.availability.toLowerCase() === "in stock",
    ).length;
    const onSale = products.filter((p) => p.salePrice.trim() !== "").length;

    return Response.json({
      data: {
        brand: { name: brand.name, domain: brand.domain },
        sitemap: { ok: !!smXml, url: smUrl, total: urls.length, byType },
        feed: {
          ok: !!fdXml,
          url: fdUrl,
          total: products.length,
          inStock,
          outOfStock: products.length - inStock,
          onSale,
          sample: products.slice(0, 50),
        },
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("storefront live route error", err);
    return Response.json({ error: "Live fetch failed" }, { status: 500 });
  }
}
