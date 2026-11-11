import { XMLParser } from "fast-xml-parser";

/**
 * Parsers for the storefront sitemaps (`<urlset>` of `<loc>`) and Google/
 * Facebook product feeds (RSS 2.0 with the `g:` namespace). We keep the `g:`
 * prefix (no removeNSPrefix) so the item-level `g:price` stays distinct from
 * the nested `g:shipping > g:price`, and disable value coercion so numeric-
 * looking ids/prices stay strings.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

export type SitemapEntry = { url: string; type: string };

export type FeedProduct = {
  id: string;
  title: string;
  link: string;
  imageLink: string;
  price: string;
  salePrice: string;
  availability: string;
  productType: string;
  googleCategory: string;
  // Optional so hand-built FeedProducts (newsletter samples) need not set them.
  hubId?: string;
  cityIds?: string;
  description?: string;
};

const KNOWN_TYPES = ["product", "collection", "blog", "page", "search"];

export function urlType(u: string): string {
  try {
    const path = new URL(u).pathname.replace(/^\/+/, "");
    if (path === "") return "home";
    const seg = path.split("/")[0]?.toLowerCase() ?? "";
    return KNOWN_TYPES.includes(seg) ? seg : "other";
  } catch {
    return "other";
  }
}

function strOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const doc = parser.parse(xml) as {
    urlset?: { url?: unknown };
  };
  const entries = asArray(doc.urlset?.url);
  const out: SitemapEntry[] = [];
  for (const u of entries) {
    const loc =
      typeof u === "string"
        ? u
        : strOf((u as Record<string, unknown>)?.loc);
    const url = strOf(loc);
    if (url) out.push({ url, type: urlType(url) });
  }
  return out;
}

export function parseFeed(xml: string): FeedProduct[] {
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown } };
  };
  const items = asArray(doc.rss?.channel?.item) as Array<
    Record<string, unknown>
  >;
  const out: FeedProduct[] = [];
  for (const it of items) {
    const id = strOf(it["g:id"]);
    if (!id) continue;
    out.push({
      id,
      title: strOf(it["g:title"]),
      link: strOf(it["g:link"]),
      imageLink: strOf(it["g:image_link"]),
      // Item-level price; the nested g:shipping > g:price is a separate object.
      price: strOf(it["g:price"]),
      salePrice: strOf(it["g:sale_price"]),
      availability: strOf(it["g:availability"]),
      productType: strOf(it["g:product_type"]),
      googleCategory: strOf(it["g:google_product_category"]),
      hubId: strOf(it["g:custom_label_0"]),
      cityIds: strOf(it["g:custom_label_2"]),
      description: strOf(it["g:description"]),
    });
  }
  return out;
}
