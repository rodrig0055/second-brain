/**
 * Brand colours, keyed on slug.
 *
 * Never on the display name. The chip used to test /SG/ against the name, which
 * is case-sensitive, so renaming the brands to "Bloomly SG" silently dropped
 * every chip to grey with no error anywhere.
 */
export type BrandTone = {
  /** Soft chip: tinted background, dark text, matching ring. */
  chip: string;
  /** Solid marker, for a calendar entry where the colour has to read at 8px. */
  dot: string;
  /** A short form for a narrow calendar cell. */
  short: string;
};

const TONES: Record<string, BrandTone> = {
  "bloomly-sg": { chip: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500", short: "SG" },
  "bloomly-ph": { chip: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", short: "PH" },
  "bloomly-th": { chip: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500", short: "TH" },
  "bloomly-vn": { chip: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", short: "VN" },
  "acme-florals": { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", short: "AF" },
  "northwind-audio": { chip: "bg-slate-100 text-slate-700 ring-slate-300", dot: "bg-slate-500", short: "BA" },
};

const FALLBACK: BrandTone = {
  chip: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  dot: "bg-zinc-400",
  short: "?",
};

export function brandTone(slug: string): BrandTone {
  return TONES[slug] ?? FALLBACK;
}

/** Every brand that has a colour, for the calendar legend. */
export function toneLegend(): Array<{ slug: string } & BrandTone> {
  return Object.entries(TONES).map(([slug, t]) => ({ slug, ...t }));
}
