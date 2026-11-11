/**
 * Filled sample content for every block kind.
 *
 * One source, three consumers: the block gallery in the app, the renderer test
 * harness, and the screenshot harness. It lived in two scripts as a copied
 * literal, which meant a block could gain a field and be checked with the old
 * shape in one place and the new one in the other.
 *
 * Pure: no database, no feed. The gallery is about how a design looks, so it
 * uses a fixed catalog rather than whatever the storefront has in stock today.
 */
import type { Block } from "./campaign";
import type { Catalog, Resolved } from "./catalog";
import { homeUrl } from "./tokens";

/**
 * Stable photos, so a design reads the same on every visit.
 *
 * Portrait for product tiles, because real storefront product shots are
 * portrait: a landscape stand-in made every grid in the gallery look short and
 * wide, which is not what the design does with real photography.
 */
export const SAMPLE_PHOTO =
  "https://images.unsplash.com/photo-1487070183336-b863922373d4?w=480&h=600&fit=crop&q=70";

/** Landscape, for the places a design really is wide: an article header. */
export const SAMPLE_WIDE =
  "https://images.unsplash.com/photo-1487070183336-b863922373d4?w=700&h=390&fit=crop&q=70";

// Most of the live catalogue is discounted, so most of these are too: a sample
// where nothing is on sale hides the strikethrough treatment entirely.
export const SAMPLE_PRODUCTS = [
  { title: "True Love", price: "129.00 SGD", salePrice: "99 SGD" },
  { title: "Love Blossom", price: "75.00 SGD", salePrice: "" },
  { title: "Sweet Charm", price: "119.00 SGD", salePrice: "89 SGD" },
  { title: "Pink Haze", price: "149.00 SGD", salePrice: "119 SGD" },
  { title: "Soft Light", price: "65.00 SGD", salePrice: "" },
  { title: "Quiet Bloom", price: "135.00 SGD", salePrice: "108 SGD" },
] as const;

export const SAMPLE_NAMES: string[] = SAMPLE_PRODUCTS.map((p) => p.title);

/** A catalog covering the sample products, priced in the brand's own currency. */
export function sampleCatalog(domain: string, currency = "SGD"): Catalog {
  const home = homeUrl(domain);
  const out: Catalog = new Map<string, Resolved | null>();
  for (const p of SAMPLE_PRODUCTS) {
    out.set(p.title, {
      id: p.title,
      title: p.title,
      link: `${home}/product/${p.title.toLowerCase().replace(/\s+/g, "-")}`,
      imageLink: SAMPLE_PHOTO,
      price: p.price.replace("SGD", currency),
      salePrice: p.salePrice ? p.salePrice.replace("SGD", currency) : "",
      availability: "in stock",
      productType: "",
      googleCategory: "",
      matchedOn: p.title,
      score: 1,
    });
  }
  return out;
}

export type SampleCtx = { brand: string; domain: string; home: string };

/**
 * Sample values for one block kind, to merge over its registered default.
 *
 * Only fields worth showing are set. A block not listed here renders from its
 * own `empty()`, which already carries real starting copy.
 */
export function sampleFor(kind: string, ctx: SampleCtx): Record<string, unknown> {
  const home = ctx.home;
  const tiles = [
    { label: "Bouquets", href: `${home}/search/flower/bouquet`, image: SAMPLE_WIDE, sub: "From S$59" },
    { label: "Hampers", href: `${home}/search/gift/hamper`, image: SAMPLE_WIDE, sub: "From S$120" },
  ];

  const m: Record<string, Record<string, unknown>> = {
    header: { tagline: "Gifts Everyone Loves" },
    occasionNav: {},
    // Deliberately empty. The footer's social row comes from the brand's own
    // confirmed profiles, so leaving these blank is what shows the real
    // behaviour. Filling them with invented handles made the gallery display
    // links that go nowhere and hid where the real ones come from.
    footer: {},
    hero: {
      badge: "9.9 MEGA SALE",
      dates: "9 TO 11 SEPTEMBER",
      headline: "LAST DAY",
      headlineAccent: "TO MAKE IT SPECIAL",
      kicker: "FREE SAME-DAY DELIVERY",
      href: home,
    },
    productGrid: {
      columns: 3, products: SAMPLE_NAMES.slice(0, 3),
      title: "This week's picks", eyebrow: "Weekly gift guide",
    },
    newArrivals: { columns: 2, products: SAMPLE_NAMES.slice(0, 2), title: "Just landed", eyebrow: "New arrivals" },
    feature: {
      product: SAMPLE_NAMES[0], note: "Only twenty left today",
      label: "Offer of the day", endsAt: "Today only, until 11:59pm",
    },
    category: { title: "Shop by category", items: tiles },
    occasionPush: { title: "Shop by occasion", items: tiles },
    promoCode: { headline: "15% OFF EVERYTHING", code: "NINE9", terms: "Minimum spend S$60. One use per customer.", href: home },
    deadline: {
      label: "Offer ends", headline: "Tonight at 11:59pm",
      sub: "Order before the cutoff and it still arrives today.", href: home,
    },
    cta: { label: "SHOP THE GUIDE", href: `${home}/search/flower/bouquet` },
    band: { line1: "Last call", line2: "for big savings", sub: "Ends at midnight tonight." },
    usp: {
      items: [
        { label: "Nationwide delivery", sub: "Every address we reach", image: "van" },
        { label: "Same-day available", sub: "Order before the cutoff", image: "clock" },
        { label: "Free greeting card", sub: "Written in your words", image: "card" },
      ],
    },
    reviews: {
      title: "What customers are saying",
      items: [
        { quote: "Arrived exactly on time and looked better than the photo.", name: "Aisha" },
        { quote: "She cried. Worth every cent.", name: "Ben" },
      ],
    },
    igTags: {
      title: "Tagged by you",
      href: "https://instagram.com/bloomly",
      items: [
        { image: SAMPLE_PHOTO, handle: "jane" },
        { image: SAMPLE_PHOTO, handle: "sam" },
      ],
    },
    appPromo: {
      feature: "New in the app",
      headline: "Track your delivery, live",
      body: "Watch it go from our shop to their door, and reorder a favourite in two taps.",
      // Left blank: the badges resolve to the brand's own listing, which is
      // what a real send does and what the gallery should therefore show.
      image: SAMPLE_PHOTO,
    },
    zodiac: {
      sign: "Virgo", dateRange: "23 AUG TO 22 SEP",
      traits: "Precise, loyal, quietly generous",
      body: "A Virgo notices the details, so send something considered rather than something loud.",
      image: SAMPLE_PHOTO, href: home, products: SAMPLE_NAMES.slice(0, 2),
    },
    giftHack: {
      title: "Gift hacks",
      items: [
        { heading: "Send it the night before", sub: "Morning delivery slots go first, especially on a Friday.", image: SAMPLE_PHOTO },
        { heading: "Write the card first", sub: "It is the part they keep.", image: SAMPLE_PHOTO },
      ],
    },
    education: {
      title: "Why your flowers last longer in a short vase",
      body: "Stems drink from the bottom, so a shorter vase means a shorter journey. Trim at an angle, change the water every other day, and keep them out of direct sun.",
      image: SAMPLE_WIDE, href: `${home}/blog/flower-care`, linkLabel: "Read the full guide",
    },
    spinWheel: {
      title: "Spin to win", body: "One spin per subscriber, every Friday.",
      buttonLabel: "SPIN THE WHEEL", href: `${home}/page/spin`, image: SAMPLE_PHOTO,
    },
    scramble: {
      title: "Guess the flower", hint: "It turns to follow the light",
      answer: "SUNFLOWER", footer: "Reply with your answer and we will send a voucher to the first ten.",
    },
    // Landscape on purpose. These rows pair a photo with a short shout, so a
    // tall portrait shot drives the row height up and leaves the copy panel
    // floating in dead space beside it.
    guide: {
      title: "Who are you sending to?",
      items: [
        { image: SAMPLE_WIDE, heading: "IF THEY ARE FAR AWAY", sub: "Send something that lasts past the day.", href: home },
        { image: SAMPLE_WIDE, heading: "IF YOU ALMOST FORGOT", sub: "Same-day delivery still has your back.", href: home },
      ],
    },
  };
  return m[kind] ?? {};
}

/** A filled instance of one block, ready to render. */
export function sampleBlock(kind: string, variant: string | undefined, ctx: SampleCtx): Block {
  return { type: kind, ...(variant ? { variant } : {}), ...sampleFor(kind, ctx) } as unknown as Block;
}
