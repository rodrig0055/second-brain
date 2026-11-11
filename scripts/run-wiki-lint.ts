import { config } from "dotenv";
config({ path: ".env.local" });

// Run the weekly wiki lint now (all brands, or one by slug).
// Usage: npx tsx scripts/run-wiki-lint.ts [brandSlug]
async function main() {
  const { db } = await import("../src/db");
  const { brands } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { lintBrand, runWeeklyLint } = await import("../src/lib/wiki/lint");

  const only = process.argv[2];
  if (only) {
    const [brand] = await db.select().from(brands).where(eq(brands.slug, only));
    if (!brand) throw new Error(`unknown brand: ${only}`);
    console.log(JSON.stringify(await lintBrand(brand.id), null, 2));
  } else {
    console.log(JSON.stringify(await runWeeklyLint(), null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
