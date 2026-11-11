/**
 * Reports stored model ids that are no longer in MODEL_OPTIONS, and with
 * --apply repoints them at their successor. The successors live in
 * RETIRED_MODEL_SUCCESSORS (src/lib/models.ts) and the daily sync cron applies
 * them on its own (src/lib/model-remap.ts); this script is for seeing the state
 * and for applying immediately instead of waiting for the next cron.
 *
 *   set -a && . ./.env.local && set +a && npx tsx scripts/remap-stale-models.ts
 *   set -a && . ./.env.local && set +a && npx tsx scripts/remap-stale-models.ts --apply
 *
 * Without --apply it only reports what it would change.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getModelOptions } from "@/lib/models";
import { remapRetiredModels, resolvedSuccessors } from "@/lib/model-remap";

const apply = process.argv.includes("--apply");

async function main() {
  // Report every stored id first, so an id that went stale without a successor
  // entry shows up as "no mapping" instead of being silently skipped.
  const known = new Set((await getModelOptions()).map((o) => o.id));
  const map = resolvedSuccessors();
  for (const table of ["task_templates", "conversations"] as const) {
    const rows = (await db.execute(
      sql`select model, count(*)::int as n from ${sql.identifier(table)}
          where model is not null group by 1 order by 2 desc`,
    )) as unknown as { rows: { model: string; n: number }[] };
    console.log(`\n${table}:`);
    for (const r of rows.rows) {
      const status = known.has(r.model)
        ? "ok"
        : map[r.model]
          ? `stale -> ${map[r.model]}`
          : "stale (no mapping)";
      console.log(`  ${r.model.padEnd(38)} ${String(r.n).padStart(3)}  ${status}`);
    }
  }

  if (!apply) {
    console.log("\n(dry run: pass --apply to write)");
    return;
  }
  console.log("\n", await remapRetiredModels());
}

main().then(() => process.exit(0));
