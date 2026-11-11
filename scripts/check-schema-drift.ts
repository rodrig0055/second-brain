/**
 * What `drizzle-kit push` would add, and what it would destroy.
 *
 * This project syncs schema by pushing `schema.ts` at the database, with no
 * migration files in between. That makes push a diff against whatever is
 * actually there, so a table created outside schema.ts — by hand, by an older
 * branch, or by another worktree — reads as something to remove. The prompt
 * that would warn you appears only on a terminal, and the database is
 * production.
 *
 * So: run this before every push. It connects read-only and writes nothing.
 *
 *   npx tsx scripts/check-schema-drift.ts
 *
 * Exits 1 if anything in the database is missing from schema.ts.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  // Imported inside main, after dotenv has run. A static import of the client
  // would read DATABASE_URL at module load, before the file above was read —
  // the same hoisting trap the other scripts here work around.
  const { neon } = await import("@neondatabase/serverless");
  const { readFile } = await import("node:fs/promises");

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (expected in .env.local).");
    process.exit(1);
  }

  const sql = neon(url);
  const rows = (await sql`
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename
  `) as { tablename: string }[];
  const inDatabase = new Set(rows.map((r) => r.tablename));

  const source = await readFile("src/db/schema.ts", "utf8");
  const inSchema = new Set(
    [...source.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]),
  );

  // Drizzle's own bookkeeping, never declared in schema.ts.
  const IGNORED = new Set(["__drizzle_migrations"]);

  const wouldDrop = [...inDatabase].filter(
    (t) => !inSchema.has(t) && !IGNORED.has(t),
  );
  const wouldCreate = [...inSchema].filter((t) => !inDatabase.has(t));

  if (wouldCreate.length) {
    console.log("Would CREATE:");
    for (const t of wouldCreate.sort()) console.log(`  + ${t}`);
  }

  if (wouldDrop.length) {
    console.log("\nWould DROP (present in the database, absent from schema.ts):");
    for (const t of wouldDrop.sort()) console.log(`  - ${t}`);
    console.log(
      "\nDo not push until each of these is either declared in schema.ts or " +
        "deliberately abandoned. Pushing drops them and their rows.",
    );
    process.exit(1);
  }

  console.log(
    wouldCreate.length
      ? "\nNothing would be dropped. Safe to push."
      : "Database matches schema.ts. Nothing to do.",
  );
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
