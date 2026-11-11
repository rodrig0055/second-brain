/**
 * Which brands may write to Meta, and which are held back by a shared account.
 *
 *   npm run check:ads:accounts
 *
 * Reads only. Prints every Meta connection's claim on an ad account, then the
 * gate's verdict per brand, so the invariant can be checked against the real
 * database rather than against fixtures.
 *
 * A brand shown as HELD is not broken: it is a connection pointing at another
 * brand's ad account, and the fix is in Admin → Integrations.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { loadAccountClaims } = await import("@/lib/ads/actions/executor");
  const { accountGate } = await import("@/lib/ads/actions/account-guard");

  const claims = await loadAccountClaims();
  if (claims.length === 0) {
    console.log("No Meta connections found.");
    return;
  }

  const byAccount = new Map<string, string[]>();
  for (const claim of claims) {
    const names = byAccount.get(claim.adAccountId) ?? [];
    if (!names.includes(claim.brandName)) names.push(claim.brandName);
    byAccount.set(claim.adAccountId, names);
  }

  console.log("CLAIMS");
  for (const [account, names] of [...byAccount].sort()) {
    const flag = names.length > 1 ? "  <- shared" : "";
    console.log(`  ${account || "(none)"}: ${names.sort().join(", ")}${flag}`);
  }

  console.log("\nGATE");
  let held = 0;
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.brandId)) continue;
    seen.add(claim.brandId);
    const verdict = accountGate(claim.adAccountId, claim.brandId, claims);
    if (verdict.ok) {
      console.log(`  PASS  ${claim.brandName}`);
    } else {
      held++;
      console.log(`  HELD  ${claim.brandName}`);
      console.log(`        ${verdict.reason}`);
    }
  }

  console.log(
    held === 0
      ? "\nEvery brand's ad account is its own."
      : `\n${held} brand(s) cannot write until a connection is repointed.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
