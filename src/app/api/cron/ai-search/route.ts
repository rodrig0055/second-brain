import { requireCronSecret } from "@/lib/cron/auth";
import { aiSearchBrand } from "@/lib/ai-search/gate";
import { runDue } from "@/lib/ai-search/run";

export const maxDuration = 300;

// Four passes each morning (see vercel.json; the Hobby plan allows each cron
// entry once a day, so the passes are four entries with the same path). One pass
// cannot ask every prompt of every assistant inside 300s, so each works through
// what is still due and the next picks up the rest. A pass with nothing due
// returns at once. Hobby fires a daily cron at any minute within its hour.
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const brand = await aiSearchBrand();
  if (!brand) return Response.json({ error: "brand not found" }, { status: 404 });
  return Response.json(await runDue(brand, { budgetMs: 230_000, concurrency: 8 }));
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
