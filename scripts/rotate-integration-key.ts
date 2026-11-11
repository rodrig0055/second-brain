/**
 * Re-encrypt every stored secret with the current write key.
 *
 *   npm run rotate:enc-key                # dry run, writes nothing
 *   npm run rotate:enc-key -- --apply     # rewrite
 *
 * Step 2 of the rotation described in src/lib/crypto.ts.
 *
 * This only works where the keys are readable, which on Vercel they are not:
 * a secret there can be written but never read back. So the usual way to run
 * step 2 is the button in Admin → Integrations, which does the same thing
 * inside the deployment where the keys actually are. This script is for a
 * machine that holds the keys in .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const apply = process.argv.includes("--apply");

  const { decryptionKeyCount, rotationInFlight } = await import("@/lib/crypto");

  if (!process.env.INTEGRATIONS_ENC_KEY && !process.env.INTEGRATIONS_ENC_KEY_NEXT) {
    console.error(
      "No encryption key is set, so nothing can be read or rotated.\n" +
        "Run this where INTEGRATIONS_ENC_KEY is available, or use the button\n" +
        "in Admin → Integrations, which runs inside the deployment.",
    );
    process.exit(2);
  }

  console.log(
    `Writing with ${rotationInFlight() ? "INTEGRATIONS_ENC_KEY_NEXT" : "INTEGRATIONS_ENC_KEY"}, ` +
      `${decryptionKeyCount()} key(s) accepted for reading.\n`,
  );

  const { rotateStoredSecrets } = await import("@/lib/crypto-rotation");
  const report = await rotateStoredSecrets({ apply });

  for (const row of report.outcomes) {
    console.log(`  ${row.status.padEnd(14)} ${row.table.padEnd(24)} ${row.label}`);
  }
  if (report.outcomes.length === 0) console.log("  (no stored secrets)");

  console.log(
    `\n${report.rewritten} secret(s) ${apply ? "rewritten" : "would be rewritten"}` +
      (report.unreadable > 0
        ? `, ${report.unreadable} unreadable with any configured key and left alone.`
        : "."),
  );

  if (report.unreadable > 0) {
    console.log(
      "\nAn unreadable secret was sealed with a key that is no longer set.\n" +
        "Add that key as INTEGRATIONS_ENC_KEY_PREVIOUS and run again, or\n" +
        "reconnect that integration in Admin → Integrations.",
    );
  }
  console.log(
    apply
      ? "\nNow set INTEGRATIONS_ENC_KEY to the new key, remove\n" +
          "INTEGRATIONS_ENC_KEY_NEXT, and deploy."
      : "\nDry run. Re-run with --apply to write.",
  );
  process.exit(report.unreadable > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
