import { config } from "dotenv";
config({ path: ".env.local" });

// Run the weekly wiki ingest now (all brands, or one by slug).
// Usage: npx tsx scripts/run-wiki-ingest.ts [brandSlug]
async function main() {
  const { db } = await import("../src/db");
  const { brands } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { ingestBrand, runWeeklyIngest } = await import("../src/lib/wiki/ingest");

  const only = process.argv[2];
  if (only) {
    const [brand] = await db.select().from(brands).where(eq(brands.slug, only));
    if (!brand) throw new Error(`unknown brand: ${only}`);
    console.log(JSON.stringify(await ingestBrand(brand), null, 2));
  } else {
    console.log(JSON.stringify(await runWeeklyIngest(), null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
