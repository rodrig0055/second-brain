import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { calendarEvents } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Brand groups by market + product. Flower/gifting brands get funerary and
// flower-first occasions (Undas, Qingming, Women's/Teachers' Day); the audio
// brand (Northwind Audio) only gets broad gifting + sale moments.
const PH_ALL = ["acme-florals", "bloomly-ph", "northwind-audio"];
const PH_FLOWERS = ["acme-florals", "bloomly-ph"];
const SG = ["bloomly-sg"];
const VN = ["bloomly-vn"];
const TH = ["bloomly-th"];
const CNY_MARKETS = [...PH_ALL, "bloomly-sg", "bloomly-th"]; // not VN (Tet)

type Seed = {
  name: string;
  date: string; // YYYY-MM-DD (floating/lunar dates set for 2026)
  recurring: boolean; // true = same month/day every year
  brandSlugs: string[] | "global"; // "global" => all brands (empty brandIds)
  notes?: string;
};

// Dates verified against official 2026 holiday calendars (SG MOM, PH
// Proclamation 1006, Vietnam & Thailand govt lists) + lunar-date lookups.
// Floating/lunar holidays are non-recurring and set to their 2026 date.
const SEED: Seed[] = [
  // ============ GLOBAL — universal gifting + SEA mega-sales ============
  { name: "New Year's Day", date: "2026-01-01", recurring: true, brandSlugs: "global" },
  { name: "Valentine's Day", date: "2026-02-14", recurring: true, brandSlugs: "global", notes: "Peak gifting. Flowers, chocolates + gift audio; start teasers ~2 weeks prior." },
  { name: "6.6 Mid-Year Sale", date: "2026-06-06", recurring: true, brandSlugs: "global", notes: "Shopee/Lazada mid-year mega-sale." },
  { name: "9.9 Sale", date: "2026-09-09", recurring: true, brandSlugs: "global", notes: "Q4 kickoff mega-sale." },
  { name: "10.10 Sale", date: "2026-10-10", recurring: true, brandSlugs: "global", notes: "Major e-commerce sale." },
  { name: "Singles' Day (11.11)", date: "2026-11-11", recurring: true, brandSlugs: "global", notes: "Biggest regional e-commerce sale of the year." },
  { name: "Black Friday", date: "2026-11-27", recurring: false, brandSlugs: "global" },
  { name: "Cyber Monday", date: "2026-11-30", recurring: false, brandSlugs: "global" },
  { name: "12.12 Sale", date: "2026-12-12", recurring: true, brandSlugs: "global", notes: "Year-end e-commerce sale." },
  { name: "Christmas Day", date: "2026-12-25", recurring: true, brandSlugs: "global", notes: "Biggest gifting season; demand ramps from late Nov." },
  { name: "New Year's Eve", date: "2026-12-31", recurring: true, brandSlugs: "global", notes: "Year-end countdown gifting + celebrations." },

  // Cross-market gifting days (dates shared across PH/SG)
  { name: "Chinese New Year", date: "2026-02-17", recurring: false, brandSlugs: CNY_MARKETS, notes: "Year of the Horse (Feb 17). Auspicious flowers, red/gold gifting, big sales." },
  { name: "Mother's Day", date: "2026-05-10", recurring: false, brandSlugs: [...PH_ALL, "bloomly-sg"], notes: "2nd Sunday of May. Peak flower-gifting day; strong gift-audio window too." },
  { name: "Father's Day", date: "2026-06-21", recurring: false, brandSlugs: [...PH_ALL, "bloomly-sg"], notes: "3rd Sunday of June. Strong for gift audio + flowers." },

  // ============ PHILIPPINES ============
  { name: "Holy Week (PH)", date: "2026-04-03", recurring: false, brandSlugs: PH_ALL, notes: "Maundy Thu Apr 2 – Easter Apr 5; Good Friday Apr 3. Travel + retail lull, then rebound." },
  { name: "Graduation Season (PH)", date: "2026-03-28", recurring: false, brandSlugs: PH_ALL, notes: "Late Mar–Apr. Huge for flowers, bouquets + gift audio." },
  { name: "Independence Day (PH)", date: "2026-06-12", recurring: true, brandSlugs: PH_ALL, notes: "Long-weekend sale driver." },
  { name: "National Heroes' Day (PH)", date: "2026-08-31", recurring: false, brandSlugs: PH_ALL, notes: "Last Monday of August. Long-weekend sale." },
  { name: "World Teachers' Day (PH)", date: "2026-10-05", recurring: true, brandSlugs: PH_FLOWERS, notes: "Flowers + tokens of appreciation for teachers." },
  { name: "Grandparents' Day (PH)", date: "2026-09-13", recurring: false, brandSlugs: PH_FLOWERS, notes: "2nd Sunday of September. Flower gifting." },
  { name: "All Saints' Day / Undas (PH)", date: "2026-11-01", recurring: true, brandSlugs: PH_FLOWERS, notes: "Nov 1–2. Major flowers + candles demand for cemetery visits." },
  { name: "Bonifacio Day (PH)", date: "2026-11-30", recurring: true, brandSlugs: PH_ALL, notes: "Regular holiday; long-weekend sale." },
  { name: "Feast of the Immaculate Conception (PH)", date: "2026-12-08", recurring: true, brandSlugs: PH_FLOWERS, notes: "Marian feast; church + flower gifting." },
  { name: "Rizal Day (PH)", date: "2026-12-30", recurring: true, brandSlugs: PH_ALL },

  // ============ SINGAPORE ============
  { name: "Qingming / Tomb-Sweeping Day (SG)", date: "2026-04-05", recurring: false, brandSlugs: SG, notes: "Apr 4–6. Flowers for ancestral graves." },
  { name: "Hari Raya Puasa (SG)", date: "2026-03-21", recurring: false, brandSlugs: SG, notes: "Eid al-Fitr (provisional, moon-dependent). Malay-Muslim gifting + visiting." },
  { name: "Labour Day (SG)", date: "2026-05-01", recurring: true, brandSlugs: SG, notes: "Long-weekend sale." },
  { name: "Hari Raya Haji (SG)", date: "2026-05-27", recurring: false, brandSlugs: SG, notes: "Eid al-Adha (provisional, moon-dependent)." },
  { name: "Vesak Day (SG)", date: "2026-05-31", recurring: false, brandSlugs: SG, notes: "Buddhist holy day (in-lieu Mon Jun 1)." },
  { name: "Great Singapore Sale (SG)", date: "2026-06-13", recurring: false, brandSlugs: SG, notes: "Nationwide mid-year retail sale (Jun–Jul)." },
  { name: "Teachers' Day (SG)", date: "2026-09-04", recurring: false, brandSlugs: SG, notes: "1st Friday of September. Flowers + appreciation gifts." },
  { name: "National Day (SG)", date: "2026-08-09", recurring: true, brandSlugs: SG, notes: "SG61. Patriotic promos; in-lieu Mon Aug 10." },
  { name: "Deepavali (SG)", date: "2026-11-08", recurring: false, brandSlugs: SG, notes: "Festival of Lights. Indian-community gifting + flowers." },

  // ============ VIETNAM ============
  { name: "Tet – Lunar New Year (VN)", date: "2026-02-17", recurring: false, brandSlugs: VN, notes: "Biggest holiday of the year (~Feb 14–22). Peach/apricot blossoms, kumquat, flower gifting." },
  { name: "International Women's Day (VN)", date: "2026-03-08", recurring: true, brandSlugs: VN, notes: "Major flower-gifting day in Vietnam." },
  { name: "Hung Kings' Commemoration (VN)", date: "2026-04-26", recurring: false, brandSlugs: VN, notes: "10th day of 3rd lunar month; national holiday." },
  { name: "Reunification Day & Labour Day (VN)", date: "2026-04-30", recurring: false, brandSlugs: VN, notes: "Apr 30 + May 1; long holiday period." },
  { name: "Vu Lan Festival (VN)", date: "2026-08-27", recurring: false, brandSlugs: VN, notes: "Parents' Day / ghost festival (15th day 7th lunar month). Flowers + gratitude gifting." },
  { name: "Vietnamese National Day (VN)", date: "2026-09-02", recurring: true, brandSlugs: VN, notes: "National holiday + sales." },
  { name: "Vietnamese Women's Day (VN)", date: "2026-10-20", recurring: true, brandSlugs: VN, notes: "Major flower-gifting day in Vietnam." },
  { name: "Vietnamese Teachers' Day (VN)", date: "2026-11-20", recurring: true, brandSlugs: VN, notes: "One of the biggest flower-gifting days of the year in Vietnam." },

  // ============ THAILAND ============
  { name: "Songkran – Thai New Year (TH)", date: "2026-04-13", recurring: true, brandSlugs: TH, notes: "Apr 13–15. Biggest Thai holiday; family gifting, jasmine garlands for elders." },
  { name: "Mother's Day (TH)", date: "2026-08-12", recurring: true, brandSlugs: TH, notes: "Queen Sirikit's birthday. Jasmine is the traditional Mother's Day flower." },
  { name: "Loy Krathong (TH)", date: "2026-11-24", recurring: false, brandSlugs: TH, notes: "Full-moon festival of lights; flowers used in krathongs." },
  { name: "Father's Day (TH)", date: "2026-12-05", recurring: true, brandSlugs: TH, notes: "King Bhumibol's birthday. Canna flower is traditional." },
];

async function main() {
  const allBrands = await db.query.brands.findMany();
  const idBySlug = new Map(allBrands.map((b) => [b.slug, b.id]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of SEED) {
    const desired =
      s.brandSlugs === "global"
        ? []
        : s.brandSlugs
            .map((slug) => idBySlug.get(slug))
            .filter((id): id is string => Boolean(id));

    const existing = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.name, s.name),
    });

    if (!existing) {
      await db.insert(calendarEvents).values({
        brandIds: desired,
        name: s.name,
        date: s.date,
        recurring: s.recurring,
        notes: s.notes ?? "",
      });
      inserted++;
      continue;
    }

    // Global events are already global — nothing to merge.
    if (s.brandSlugs === "global") {
      skipped++;
      continue;
    }
    // Merge in any brands the existing row is missing (never narrows scope).
    const union = Array.from(new Set([...existing.brandIds, ...desired]));
    if (union.length !== existing.brandIds.length) {
      await db
        .update(calendarEvents)
        .set({ brandIds: union })
        .where(eq(calendarEvents.id, existing.id));
      updated++;
    } else {
      skipped++;
    }
  }
  console.log(
    `Calendar seed: ${inserted} inserted, ${updated} re-scoped, ${skipped} unchanged. Total events: ${
      (await db.query.calendarEvents.findMany()).length
    }.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
