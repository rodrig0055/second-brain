import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, teams } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const NAME = "Meta Creative — Weekly Top & Bottom";

const PROMPT = `Produce a weekly Meta creative-performance report for the selected brand.

Reporting window (inclusive): {{start_date}} to {{end_date}}
Win metric: {{metric}} (a "win" beats this target)
Win threshold: {{threshold}}

Use the metaCreativeInsights tool for that date range, metric and threshold. If it reports no classified creatives with spend, say so plainly and tell the reader to run "Analyze creatives" on Dashboards → Meta Creative first, then stop.

Otherwise, write a concise report:
1. A short headline summary of how creative performed this week.
2. Win-rate by category — call out the asset type, messaging angle, hook tactic and funnel stage with the highest and lowest win-rates (and the spend behind them).
3. Top performers — the winning creatives with real spend; note what they have in common.
4. Bottom performers — the biggest-spend losers to fix or cut.
5. 3 concrete recommendations for next week's creative tests, grounded in the data above and the brand's voice.

Base every number on the tool output — never invent metrics.`;

const inputFields = [
  { name: "start_date", label: "Start date (YYYY-MM-DD)", type: "date" as const, required: true },
  { name: "end_date", label: "End date (YYYY-MM-DD)", type: "date" as const, required: true },
  {
    name: "metric",
    label: "Win metric",
    type: "select" as const,
    required: true,
    options: ["roas", "cpa", "ctr", "purchases"],
  },
  { name: "threshold", label: "Win threshold", type: "number" as const, required: true, placeholder: "1.5" },
];

async function main() {
  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, "meta-ads"),
  });
  if (!team) throw new Error("meta-ads team not found — run db:seed first.");

  const existing = await db.query.taskTemplates.findFirst({
    where: and(eq(taskTemplates.teamId, team.id), eq(taskTemplates.name, NAME)),
  });

  const values = {
    teamId: team.id,
    name: NAME,
    description:
      "Weekly Meta creative report: win-rate by category, top & bottom performers with AI insight. Pick brand, window, metric and target at run time. Requires creatives analyzed on the Meta Creative dashboard.",
    promptTemplate: PROMPT,
    inputFields,
    model: "google/gemini-3.1-pro-preview",
    renderAs: "report" as const,
    isActive: true,
  };

  if (existing) {
    await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, existing.id));
    console.log("Updated existing template:", NAME);
  } else {
    await db.insert(taskTemplates).values(values);
    console.log("Created template:", NAME, "(meta-ads team)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
