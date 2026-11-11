/**
 * URL derivation for a brand's public storefront.
 *
 * Defaults follow the most common convention (`/sitemap.xml` and a Google
 * Merchant feed). Override per deployment with STOREFRONT_SITEMAP_PATH and
 * STOREFRONT_FEED_PATH. Both accept a `{cc}` token, replaced by the uppercase
 * country code taken from the domain's last label (shop.example.sg -> SG).
 */

export function countryCode(domain: string): string {
  const label = domain.toLowerCase().replace(/\/+$/, "").split(".").pop() ?? "";
  return label.toUpperCase();
}

function build(domain: string, path: string): string {
  const p = path.replaceAll("{cc}", countryCode(domain));
  return `https://${domain}${p.startsWith("/") ? p : `/${p}`}`;
}

export function sitemapUrl(domain: string): string {
  return build(domain, process.env.STOREFRONT_SITEMAP_PATH ?? "/sitemap.xml");
}

export function feedUrl(domain: string): string {
  return build(domain, process.env.STOREFRONT_FEED_PATH ?? "/feed.xml");
}
