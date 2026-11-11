import { config } from "dotenv";
config({ path: ".env.local" });

// Regenerate the wiki-index doc for one brand (or all).
// Usage: npx tsx scripts/run-wiki-index.ts [brandSlug]
async function main() {
  const { db } = await import("../src/db");
  const { brands } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { regenerateWikiIndex } = await import("../src/lib/wiki/index-doc");
  const only = process.argv[2];
  const rows = only
    ? await db.select().from(brands).where(eq(brands.slug, only))
    : await db.select().from(brands);
  for (const b of rows) {
    await regenerateWikiIndex(b.id);
    console.log("indexed", b.slug);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
