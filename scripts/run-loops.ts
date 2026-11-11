import { config } from "dotenv";
config({ path: ".env.local" });

// Drive the loops pipeline manually.
// Usage: npx tsx scripts/run-loops.ts <rollup|advance|validate|all> [brandSlug]
async function main() {
  const [stage = "all", brandSlug] = process.argv.slice(2);
  const { db } = await import("../src/db");
  const { brands, openLoops, hypotheses } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { buildBrainTools } = await import("../src/lib/tools/brain-tools");
  const { rollupBrandLoops, runWeeklyRollup } = await import("../src/lib/loops/rollup");
  const { advanceLoop } = await import("../src/lib/loops/advance");
  const { validateHypothesis } = await import("../src/lib/loops/validate");

  const toolNamesFor = async (b: { id: string; slug: string; name: string }) => {
    const [row] = await db.select().from(brands).where(eq(brands.id, b.id));
    return Object.keys(await buildBrainTools(row));
  };

  const brandRows = brandSlug
    ? await db.select().from(brands).where(eq(brands.slug, brandSlug))
    : await db.select().from(brands);

  if (stage === "rollup" || stage === "all") {
    if (brandSlug) {
      const b = brandRows[0];
      console.log("ROLLUP:", JSON.stringify(await rollupBrandLoops(b, await toolNamesFor(b)), null, 2));
    } else {
      console.log("ROLLUP:", JSON.stringify(await runWeeklyRollup(toolNamesFor), null, 2));
    }
  }

  if (stage === "advance" || stage === "all") {
    for (const b of brandRows) {
      const promoted = await db.select().from(openLoops)
        .where(and(eq(openLoops.brandId, b.id), eq(openLoops.state, "promoted")));
      for (const l of promoted) {
        console.log("ADVANCE:", JSON.stringify(await advanceLoop(l.id, await toolNamesFor(b))));
      }
    }
  }

  if (stage === "validate" || stage === "all") {
    for (const b of brandRows) {
      const ready = await db.select().from(hypotheses)
        .where(and(eq(hypotheses.brandId, b.id), eq(hypotheses.state, "ready")));
      for (const h of ready) {
        console.log("VALIDATE:", JSON.stringify(await validateHypothesis(h.id), null, 2));
      }
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
