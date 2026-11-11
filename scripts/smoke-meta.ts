import { config } from "dotenv";
config({ path: ".env.local" });

import {
  DEFAULT_API_VERSION,
  fetchInsights,
  verifyMetaCredentials,
  type MetaTarget,
} from "../src/lib/integrations/meta/client";

async function main() {
  const token = process.env.ACCESS_TOKEN!;
  const account = process.env.AD_ACCOUNT_ID!;
  if (!token || !account) throw new Error("ACCESS_TOKEN / AD_ACCOUNT_ID not set");

  const info = await verifyMetaCredentials(token, account);
  console.log("✓ account:", info);

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const target: MetaTarget = {
    accountId: account.startsWith("act_") ? account : `act_${account}`,
    apiVersion: DEFAULT_API_VERSION,
    accessToken: token,
  };
  const rows = await fetchInsights(target, "account", start, end);
  console.log(`✓ ${rows.length} daily account rows (${start} → ${end})`);
  console.log(rows.slice(0, 3));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
