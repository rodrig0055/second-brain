/**
 * Brand colours moved to `@/lib/brand-tone`: they are not a newsletter concern
 * any more, the social calendar and the brand scope bar key on them too.
 * Re-exported so existing imports keep working. The status styling below stays
 * here, because those are newsletter campaign statuses.
 */
export { brandTone, toneLegend, type BrandTone } from "@/lib/brand-tone";

/**
 * Status as a ring style on a calendar entry.
 *
 * The brand owns the colour, so status cannot also use hue or the two compete.
 * It reads as weight instead: a draft is outlined, approved is solid, sent is
 * faded because it is done.
 */
export function statusStyle(status: string): string {
  switch (status) {
    case "ready": return "ring-1 ring-inset ring-emerald-400 font-semibold";
    case "handed_off": return "ring-1 ring-inset ring-emerald-500 font-semibold";
    case "sent": return "opacity-55";
    case "needs_art": return "ring-1 ring-inset ring-amber-400 border-dashed";
    case "archived": return "opacity-40 line-through";
    default: return "ring-1 ring-inset ring-zinc-300";
  }
}
