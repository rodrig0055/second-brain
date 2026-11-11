import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Guard the prompt cache prefix.
 *
 * buildSystemPrompt is deliberately split into a byte-stable leading block and a
 * volatile tail starting at "# Active context" (see src/lib/prompt.ts). Every
 * provider's prompt cache reuses the stable block, so one per-call value leaking
 * into it silently disables caching for the whole prompt — no error, no failing
 * test, just a quiet cost increase.
 *
 * Regex-hunting for date-shaped strings can't work here: a stored `generated_on`
 * stamp is cache-safe (it moves only when the doc is regenerated) while a
 * computed "as of today" is not, and the two look identical. So this tests the
 * actual property instead — it builds the prompt twice with the clock shifted
 * between builds, and requires the stable block to be byte-identical anyway.
 * Anything derived from the clock shows up immediately.
 *
 * Usage: npx tsx scripts/check-prompt-cache-prefix.ts [brandSlug] [teamSlug]
 *        (no args = every brand x team pair)
 * Exit 1 on any violation, so it can gate a deploy.
 */

const BOUNDARY = "# Active context";
const CLOCK_SHIFT_MS = 45 * 24 * 60 * 60 * 1000; // 45 days: crosses every cadence

function stableBlock(prompt: string): string {
  const i = prompt.indexOf(BOUNDARY);
  return i === -1 ? prompt : prompt.slice(0, i);
}

/** Run `fn` with Date shifted forward, then restore. */
async function withClockShift<T>(offsetMs: number, fn: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  class ShiftedDate extends RealDate {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as [any]));
    }
    static now() {
      return RealDate.now() + offsetMs;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.Date = ShiftedDate as any;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

async function main() {
  const [brandSlug, teamSlug] = process.argv.slice(2);
  const { db } = await import("../src/db");
  const { brands, teams } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildSystemPrompt } = await import("../src/lib/prompt");

  const brandRows = brandSlug
    ? await db.select().from(brands).where(eq(brands.slug, brandSlug))
    : await db.select().from(brands);
  const teamRows = teamSlug
    ? await db.select().from(teams).where(eq(teams.slug, teamSlug))
    : await db.select().from(teams);

  if (brandRows.length === 0 || teamRows.length === 0) {
    throw new Error(`no brand/team matched: ${brandSlug ?? "*"}/${teamSlug ?? "*"}`);
  }

  const failures: string[] = [];
  const vacuous: string[] = [];
  let checked = 0;

  for (const brand of brandRows) {
    for (const team of teamRows) {
      const label = `${brand.slug}/${team.slug}`;
      const now = await buildSystemPrompt(brand.id, team.id);
      const later = await withClockShift(CLOCK_SHIFT_MS, () =>
        buildSystemPrompt(brand.id, team.id),
      );
      checked++;

      const a = stableBlock(now);
      const b = stableBlock(later);

      if (a !== b) {
        const at = firstDiff(a, b);
        failures.push(
          `${label}: stable block moved when the clock moved, at offset ${at}\n` +
            `    now:   ${JSON.stringify(a.slice(Math.max(0, at - 70), at + 70))}\n` +
            `    +45d:  ${JSON.stringify(b.slice(Math.max(0, at - 70), at + 70))}`,
        );
        continue;
      }

      // Sanity: the tail MUST move, or the clock shift didn't take and this
      // whole check is vacuously passing.
      if (now === later) vacuous.push(label);

      console.log(`ok   ${label}  (${a.length} bytes cached)`);
    }
  }

  if (vacuous.length > 0) {
    console.error(
      `\nHARNESS BROKEN: the volatile tail did not change under a 45-day clock ` +
        `shift for ${vacuous.length} pair(s), so the stable-block check proved ` +
        `nothing. First: ${vacuous[0]}`,
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length}/${checked} pairs LEAK a clock-derived value:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    console.error(
      "Anything computed from the current time must live below the " +
        `"${BOUNDARY}" boundary, or prompt caching is disabled for the whole prompt.`,
    );
    process.exit(1);
  }

  console.log(`\n${checked}/${checked} pairs cache-safe under a 45-day clock shift`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
