import { requireCronSecret } from "@/lib/cron/auth";
import { runScheduledTasks } from "@/lib/cron/blocks";

export const maxDuration = 300;

// Daily. Per-row `frequency` decides whether a given schedule fires today, so
// this runs every day even though some rows are weekly.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return Response.json(await runScheduledTasks());
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
