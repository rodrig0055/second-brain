import { config } from "dotenv";
config({ path: ".env.local" });

// Run the weekly proposals pass now (all brands, or one by slug).
// Usage: npx tsx scripts/run-proposals.ts [brandSlug]
async function main() {
  const { db } = await import("../src/db");
  const { brands } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { proposeForBrand, runWeeklyProposals } = await import(
    "../src/lib/proposals/propose"
  );

  const only = process.argv[2];
  const ref = `manual-${new Date().toISOString().slice(0, 16)}`;
  if (only) {
    const [brand] = await db.select().from(brands).where(eq(brands.slug, only));
    if (!brand) throw new Error(`unknown brand: ${only}`);
    console.log(JSON.stringify(await proposeForBrand(brand, ref), null, 2));
  } else {
    console.log(JSON.stringify(await runWeeklyProposals(ref), null, 2));
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
