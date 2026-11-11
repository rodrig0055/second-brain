/**
 * Bloomly SG newsletter design tokens.
 *
 * Colours are sampled from the shipped JPG slices (histograms), not guessed.
 * The face is Poppins: confirmed by rendering candidate fonts beside the real
 * "WEEKLY GIFT GUIDE:" slice from the 2026-09-12 send. Nunito -- the storefront
 * font in the brand kit -- was the earlier guess and is visibly wrong for the
 * emails, which is why it is not the fallback here either.
 */
export const T = {
  navy: "#374469",
  /** A step darker than navy, for a button under the cursor. */
  navyDeep: "#2A3452",
  pink: "#D63A60",
  lavender: "#F0F4FF",
  blush: "#FFCEDA",
  tile: "#F1F2F6",
  white: "#FFFFFF",
  bodyText: "#374469",
  // Webfont for the rendered-image path (Chrome fetches it). Gmail strips
  // webfonts, so the live-text path degrades to the fallbacks by design.
  display: `Poppins, "Segoe UI", "Trebuchet MS", Arial, sans-serif`,
  googleFonts:
    "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap",
  contentWidth: 600,
  renderWidth: 700, // shipped slices are 700px, displayed at 600
} as const;

/**
 * @deprecated The storefront is per campaign. Use `homeUrl(campaign.domain)`.
 * Kept only so nothing silently compiles against a missing export.
 */
export const SITE = "https://bloomly-sg.example";

/** A brand's storefront root, from the campaign's own domain. */
export function homeUrl(domain: string): string {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

/**
 * Price as the storefront writes it. The feed returns "99.00 SGD" or
 * "1500.00 PHP"; an SGD-only formatter left every other market showing a raw
 * ISO code, and VND figures are large enough that separators matter.
 */
const CURRENCY: Record<string, string> = {
  SGD: "S$", PHP: "\u20B1", THB: "\u0E3F", VND: "\u20AB", USD: "$", MYR: "RM", IDR: "Rp",
};

export function money(raw: string): string {
  const m = raw.trim().match(/^([\d.,]+)\s*([A-Z]{3})$/);
  if (!m) return raw;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  const sym = CURRENCY[m[2]];
  const shown = n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return sym ? `${sym}${shown}` : `${shown} ${m[2]}`;
}

/**
 * What a product actually costs today, and what it cost before.
 *
 * The feed carries both `price` and `g:sale_price`, and the newsletter had been
 * showing `price` only. 254 of the 332 live SG products are genuinely
 * discounted, so a send during a 9.9 or Payday sale was quoting the
 * pre-discount figure: S$145 for something on the shelf at S$108. For a brand
 * whose calendar is mostly sales, that undersold every product in every grid.
 *
 * `was` is returned only when the sale price is genuinely lower. A feed row
 * where it is equal, higher or unparseable (there is a S$1 test product priced
 * "up" to S$2) yields the plain price and no strikethrough.
 */
export function priceParts(p: { price: string; salePrice?: string }): { now: string; was: string | null } {
  const num = (v: string) => {
    const m = /^([\d.,]+)\s*[A-Z]{3}$/.exec((v || "").trim());
    const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  const full = num(p.price);
  const sale = num(p.salePrice ?? "");
  if (!Number.isFinite(sale) || !Number.isFinite(full) || sale >= full) {
    return { now: p.price ? money(p.price) : "", was: null };
  }
  return { now: money(p.salePrice!), was: money(p.price) };
}

/** The four evergreen occasion slots. Top click target in every review tab. */
export const OCCASION_SLUGS = [
  { label: "Birthday", slug: "birthday" },
  { label: "Anniversary", slug: "anniversary" },
  { label: "Romance", slug: "romance" },
  { label: "Just Because", slug: "just-because" },
] as const;

export type Occasion = { label: string; slug: string; href: string };

/**
 * The occasion nav for one brand. These were hardcoded to bloomly-sg.example, which
 * meant a Bloomly PH campaign sent every PH subscriber to the Singapore store.
 */
export function occasions(domain: string): Occasion[] {
  const home = homeUrl(domain);
  return OCCASION_SLUGS.map((o) => ({ ...o, href: `${home}/search/occasions/${o.slug}` }));
}

/**
 * Brands whose real logo lockup and occasion icons have been extracted from a
 * shipped send and committed under public/newsletter/<key>/. A brand that is
 * not here falls back to a text lockup rather than borrowing another brand's
 * logo, which is what happened before: every campaign rendered Bloomly SG's.
 */
const ASSET_KEY: Record<string, string> = { "bloomly-sg.example": "sg" };

export type BrandAssets = { header: string; nav: Record<string, string> };

/** Static assets for a brand, or null when none have been supplied yet. */
export function brandAssets(base: string, domain: string): BrandAssets | null {
  const key = ASSET_KEY[domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")];
  if (!key) return null;
  const b = base.replace(/\/+$/, "");
  return {
    header: `${b}/newsletter/${key}/header.jpg`,
    nav: Object.fromEntries(
      OCCASION_SLUGS.map((o) => [o.slug, `${b}/newsletter/${key}/nav-${o.slug}.jpg`]),
    ),
  };
}

export function hasBrandAssets(domain: string): boolean {
  return !!ASSET_KEY[domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")];
}

export type Network = "instagram" | "facebook" | "tiktok";

export const NETWORKS: Network[] = ["instagram", "facebook", "tiktok"];

const NETWORK_LABEL: Record<Network, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

/**
 * Verified social profiles, per brand.
 *
 * Only profiles confirmed against the live account are listed. A wrong URL here
 * sends every subscriber to somebody else's page, so a brand or network that
 * could not be confirmed is simply absent and the checks panel asks for it,
 * rather than being guessed from the domain. bloomly-sg.example has no confirmed TikTok,
 * bloomly-ph.example no confirmed Instagram, and VN, TH and Northwind Audio none at all.
 */
const SOCIAL: Record<string, Partial<Record<Network, string>>> = {
  "bloomly-sg.example": {
    instagram: "https://www.instagram.com/bloomly-sg.example/",
    facebook: "https://www.facebook.com/bloomly-sg.example",
    tiktok: "https://www.tiktok.com/@bloomly-sg.example",
  },
  "bloomly-ph.example": {
    facebook: "https://www.facebook.com/bloomly-ph.example/",
    tiktok: "https://www.tiktok.com/@bloomly-ph.example",
  },
  "acmeflorals.example": {
    instagram: "https://www.instagram.com/acmeflorals.example/",
    tiktok: "https://www.tiktok.com/@acmeflorals.example",
  },
};

export type SocialLink = { network: Network; label: string; href: string; icon: string };

const bare = (domain: string) => domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/**
 * The footer's social row for one brand.
 *
 * `overrides` lets a single campaign point at something else (a takeover
 * account, a campaign-specific profile) without editing the brand.
 */
export function socialLinks(
  base: string,
  domain: string,
  overrides: Partial<Record<Network, string>> = {},
): SocialLink[] {
  const brand = SOCIAL[bare(domain)] ?? {};
  const b = base.replace(/\/+$/, "");
  return NETWORKS.flatMap((network) => {
    // An override has to BE a URL. A campaign was found with the caption
    // "Send Gifts in Taps" typed into all three fields, which the footer would
    // otherwise have emitted as three href="Send Gifts in Taps" links. Prose
    // falls back to the brand profile and is reported rather than shipped.
    const href = (isHttpUrl(overrides[network]) ? overrides[network]! : brand[network] || "").trim();
    if (!href) return [];
    return [{
      network,
      label: NETWORK_LABEL[network],
      href,
      icon: `${b}/newsletter/social/${network}.png`,
    }];
  });
}

/** A value usable as a link target. Anything else is a typo or a caption. */
export function isHttpUrl(v: string | undefined): boolean {
  if (!v || !v.trim()) return false;
  try {
    return /^https?:$/.test(new URL(v.trim()).protocol);
  } catch {
    return false;
  }
}

/** Social override fields that were filled in with something that is not a URL. */
export function badSocialOverrides(overrides: Partial<Record<Network, string>>): Network[] {
  return NETWORKS.filter((n) => {
    const v = overrides[n];
    return !!v && v.trim() !== "" && !isHttpUrl(v);
  });
}

/** True when a brand has at least one confirmed profile. */
export function hasSocials(domain: string): boolean {
  return Object.keys(SOCIAL[bare(domain)] ?? {}).length > 0;
}

export type AppLinks = { ios: string; android: string };

/**
 * The real app listings, per brand.
 *
 * Verified against the live stores: the Bloomly app (id6446608418 /
 * com.bloomly.app) serves the whole Bloomly family, and Acme Florals ships its
 * own (id1662428596 / com.acmeflorals.example). No confirmed listing for Northwind Audio,
 * so its footer shows no badges rather than badges that 404.
 *
 * The Apple URL deliberately omits a region. `apps.apple.com/app/id...`
 * redirects to whichever store the reader is signed in to, which matters for a
 * send that crosses SG, PH, VN and TH; a hardcoded /sg/ would show everyone
 * else "not available in your region".
 */
const BLOOMLY_APP: AppLinks = {
  ios: "https://apps.apple.com/app/id6446608418",
  android: "https://play.google.com/store/apps/details?id=com.bloomly.app",
};

const APPS: Record<string, AppLinks> = {
  "bloomly-sg.example": BLOOMLY_APP,
  "bloomly-ph.example": BLOOMLY_APP,
  "bloomly-vn.example": BLOOMLY_APP,
  "bloomly-th.example": BLOOMLY_APP,
  "acmeflorals.example": {
    ios: "https://apps.apple.com/app/id1662428596",
    android: "https://play.google.com/store/apps/details?id=com.acmeflorals.example",
  },
};

/** App links for a brand, with per-campaign overrides taking precedence. */
export function appLinks(domain: string, overrides: Partial<AppLinks> = {}): AppLinks {
  const brand = APPS[bare(domain)] ?? { ios: "", android: "" };
  return {
    ios: isHttpUrl(overrides.ios) ? overrides.ios!.trim() : brand.ios,
    android: isHttpUrl(overrides.android) ? overrides.android!.trim() : brand.android,
  };
}

/** True when a brand has a confirmed app listing. */
export function hasApp(domain: string): boolean {
  return !!APPS[bare(domain)];
}

/** The official store badge artwork, committed under public/newsletter/badges. */
export function storeBadge(base: string, store: "ios" | "android"): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/newsletter/badges/${store === "ios" ? "app-store" : "google-play"}.png`;
}
