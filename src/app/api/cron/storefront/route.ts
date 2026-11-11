import { requireCronSecret } from "@/lib/cron/auth";
import { runStorefrontSnapshots } from "@/lib/cron/blocks";

export const maxDuration = 300;

// Weekly, Mondays. Scheduled before Tuesday's wiki ingest so ingest reads a
// fresh catalog. The day lives in the cron expression, not in this code.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return Response.json({ storefront: await runStorefrontSnapshots() });
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
