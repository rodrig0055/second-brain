/**
 * Regression check for the image studio's planning classifier
 * (src/lib/image-settings-decide.ts) on 26 real past studio briefs, each with
 * the planning level a person expected, written down before the first run.
 * Reads image_generations (read-only) and makes 26 cheap classifier calls.
 * Baseline 2026-11-05 on gemini-3.5-flash-lite: 25/26, ~1.4s per brief.
 *
 *   set -a && . ./.env.local && set +a && \
 *     npx tsx --require ./scripts/_server-only-shim.cjs scripts/eval-image-settings.ts
 *   EVAL_MODEL=google/gemini-3.5-flash ...   # try another model alone
 */
import { db } from "@/db";
import { imageGenerations } from "@/db/schema";
import { decideImageSettings } from "@/lib/image-settings-decide";
// id prefix -> expected complexity (written before running). "low|medium" = either is acceptable.
const EXPECT: Record<string, string> = {
  c1e4e3ba: "low", "354f2da6": "low", "3694755c": "low", "15bd80ca": "low", "1b18fb9b": "low",
  "98990081": "low", "92aa32ac": "low", e79823bc: "low", "7196b67b": "low", "0adc59c4": "low",
  "014bceed": "low", ccbde595: "low|medium", d85923ec: "low|medium", "8c7f902e": "low", "916c88bc": "low",
  "36a4226a": "medium", "096c6900": "medium", "29252ce6": "medium", "2e210bc6": "medium", abceb89d: "medium",
  "2d39baa3": "low|medium", "348ca3d7": "high", dad56009: "high", "0f830e73": "high|medium",
  "678af765": "high", d59406ad: "high",
};
async function main() {
  const all = await db.select({ id: imageGenerations.id, brief: imageGenerations.brief, refs: imageGenerations.referenceUrls }).from(imageGenerations);
  const rows = all.filter((r) => EXPECT[r.id.slice(0, 8)]);
  const byPrefix = new Map(rows.map((r) => [r.id.slice(0, 8), r]));
  let agree = 0; const t0 = Date.now();
  const results = await Promise.all(Object.keys(EXPECT).map(async (p) => {
    const r = byPrefix.get(p)!;
    const t = Date.now();
    const s = await decideImageSettings({ brief: r.brief, hasReferences: r.refs.length > 0, output: "image", models: process.env.EVAL_MODEL ? [process.env.EVAL_MODEL] : undefined });
    return { p, r, s, ms: Date.now() - t };
  }));
  for (const { p, r, s, ms } of results) {
    const ok = EXPECT[p].split("|").includes(s.complexity);
    if (ok) agree++;
    console.log(`${ok ? "OK  " : "MISS"} ${p} refs=${r.refs.length} expect=${EXPECT[p].padEnd(11)} got=${s.complexity.padEnd(6)} fine=${s.fineDetail ? "Y" : "n"} src=${s.source} ${ms}ms | ${r.brief.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  console.log(`agree ${agree}/${results.length}, wall ${Date.now() - t0}ms`);
  process.exit(0);
}
main();
