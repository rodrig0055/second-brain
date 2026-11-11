import { requireCronSecret } from "@/lib/cron/auth";
import { runIntegrationSync } from "@/lib/cron/blocks";
import { remapRetiredModels } from "@/lib/model-remap";

export const maxDuration = 300;

// Daily. Repoints stored model ids that a model refresh retired, then refreshes
// external data integrations. The remap goes first: it is two small updates,
// so it cannot be starved by a slow sync, and it lands before the 08:00 UTC
// scheduled-task cron runs templates.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const models = await remapRetiredModels();
  return Response.json({ models, sync: await runIntegrationSync() });
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
