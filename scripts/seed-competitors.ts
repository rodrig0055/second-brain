import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { competitors } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

type Seed = {
  name: string;
  domain: string;
  brandSlugs: string[];
  notes?: string;
};

// Demo competitors per brand. Replace with your own (Ahrefs "competing domains"
// is a good source). A domain may compete with several brands.
const SEED: Seed[] = [
  { name: "Petal Express", domain: "petalexpress.example", brandSlugs: ["acme-florals"], notes: "Same-day flower delivery." },
  { name: "Stem & Co", domain: "stemandco.example", brandSlugs: ["acme-florals", "bloomly-ph"], notes: "Flowers and gifts." },
  { name: "GiftBox Hub", domain: "giftboxhub.example", brandSlugs: ["bloomly-ph", "bloomly-sg"], notes: "Hampers and corporate gifts." },
  { name: "Orchid Lane", domain: "orchidlane.example", brandSlugs: ["bloomly-sg"], notes: "Premium florist." },
  { name: "Lotus Flowers", domain: "lotusflowers.example", brandSlugs: ["bloomly-vn", "bloomly-th"], notes: "Regional flower delivery." },
  { name: "SoundHaus", domain: "soundhaus.example", brandSlugs: ["northwind-audio"], notes: "Audio retailer." },
];

async function main() {
  const allBrands = await db.query.brands.findMany();
  const idBySlug = new Map(allBrands.map((b) => [b.slug, b.id]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of SEED) {
    const desired = s.brandSlugs
      .map((slug) => idBySlug.get(slug))
      .filter((id): id is string => Boolean(id));

    // Idempotent by domain: merge brand scope if it already exists.
    const existing = await db.query.competitors.findFirst({
      where: eq(competitors.domain, s.domain),
    });
    if (!existing) {
      await db.insert(competitors).values({
        brandIds: desired,
        name: s.name,
        domain: s.domain,
        notes: s.notes ?? "",
      });
      inserted++;
      continue;
    }
    const union = Array.from(new Set([...existing.brandIds, ...desired]));
    if (union.length !== existing.brandIds.length) {
      await db
        .update(competitors)
        .set({ brandIds: union })
        .where(eq(competitors.id, existing.id));
      updated++;
    } else {
      skipped++;
    }
  }
  console.log(
    `Competitors seed: ${inserted} inserted, ${updated} re-scoped, ${skipped} unchanged. Total: ${
      (await db.query.competitors.findMany()).length
    }.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
