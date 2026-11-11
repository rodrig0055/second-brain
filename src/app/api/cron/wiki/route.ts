import { requireCronSecret } from "@/lib/cron/auth";
import { runWikiMaintenance } from "@/lib/cron/blocks";

export const maxDuration = 300;

// Weekly, Tuesdays. This is the block that silently stopped completing when it
// shared a 300s budget with everything else; it now owns its own invocation.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return Response.json(await runWikiMaintenance());
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
