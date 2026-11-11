import { requireCronSecret } from "@/lib/cron/auth";
import { runLoopValidations } from "@/lib/cron/blocks";

export const maxDuration = 300;

// Daily. Re-opens stale verdicts and runs whatever validations are due, bounded
// by the cap inside runDueValidations.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return Response.json({ loops: await runLoopValidations() });
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
