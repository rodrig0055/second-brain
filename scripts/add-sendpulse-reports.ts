import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, teams } from "../src/db/schema";
import type { TemplateInputField } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Reporting needs reliable multi-row aggregation — use a Pro model, not flash-lite.
const MODEL = "google/gemini-3.1-pro-preview";
const TEAM_SLUG = "newsletter";

// Shared input fields ------------------------------------------------------
const date = (name: string, label: string, placeholder: string): TemplateInputField => ({
  name,
  label,
  type: "date",
  required: true,
  placeholder,
});
const notes: TemplateInputField = {
  name: "notes",
  label: "Extra focus / context (optional)",
  type: "textarea",
};

const DATA_RULES =
  "Use the SendPulse tools to fetch REAL numbers for the active brand — never invent metrics. " +
  "Call `sendpulseEmailSummary` for period totals and report its pre-computed rate fields " +
  "(openRate, ctr, clickToOpenRate, bounceRate, unsubscribeRate) VERBATIM — do NOT recompute " +
  "rates from the raw counts. Call `sendpulseCampaigns` for per-campaign detail. If a tool " +
  "errors or returns zero campaigns, say so plainly and stop rather than guessing. Format money " +
  "and percentages exactly as returned. Dates are YYYY-MM-DD.\n\n" +
  "STRUCTURE: return a structured report — a clear `title` and the `period` covered; the headline " +
  "metrics in `kpis` (each a label + pre-formatted value, e.g. 'Open rate' / '13.1%', with an " +
  "optional sublabel like 'of 16,614 delivered'); per-campaign / comparison data in " +
  "`sections[].table` as columns + rows of strings (every row length must match the columns); " +
  "observations in `sections[].bullets` or `note`; and action items in `recommendations`.";

type Report = {
  name: string;
  description: string;
  promptTemplate: string;
  inputFields: TemplateInputField[];
};

const reports: Report[] = [
  {
    name: "Weekly Email Report",
    description:
      "Full week of email sends: headline metrics, per-campaign table, best/worst, and takeaways.",
    promptTemplate: `Produce the weekly email report for the active brand covering {{start_date}} to {{end_date}}.

1. Call sendpulseEmailSummary for the range. Lead with the headline: campaigns sent, emails delivered, openRate, ctr, clickToOpenRate, unsubscribeRate, bounceRate — verbatim from the tool.
2. Call sendpulseCampaigns for the range. Show a per-campaign table: date, campaign, sent, delivered, openRate, ctr.
3. Call out the best and worst campaign by open rate and by CTR.
4. End with 2–3 concrete takeaways (what worked, what to fix next week).

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("start_date", "Week start", "2026-06-29"),
      date("end_date", "Week end", "2026-07-05"),
      notes,
    ],
  },
  {
    name: "Campaign Performance Breakdown",
    description:
      "Ranks every campaign in a period against the period average and flags over/under-performers.",
    promptTemplate: `Break down every email campaign for the active brand between {{start_date}} and {{end_date}}.

Call sendpulseEmailSummary for the period average, then sendpulseCampaigns for the detail.
Rank campaigns by open rate and separately by CTR. For each, mark whether it beat or trailed the period average open rate / CTR. Explicitly flag any campaign that under-performed the average by a wide margin and any standout winner. Group observations into a short "what the winners had in common" note.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("start_date", "Start date", "2026-06-01"),
      date("end_date", "End date", "2026-06-30"),
      notes,
    ],
  },
  {
    name: "Period-over-Period Comparison",
    description:
      "Compares two windows (e.g. this week vs last) with deltas in sends, open rate, CTR, unsubs.",
    promptTemplate: `Compare email performance for the active brand between two periods.

Baseline period: {{baseline_start}} to {{baseline_end}}
Recent period: {{recent_start}} to {{recent_end}}

Call sendpulseEmailSummary once for EACH period. Present a side-by-side table (baseline vs recent vs delta) for: campaigns, delivered, openRate, ctr, clickToOpenRate, unsubscribeRate. State clearly whether engagement improved or declined and by how much, and give the single most likely reason based on the numbers.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("baseline_start", "Baseline start", "2026-06-22"),
      date("baseline_end", "Baseline end", "2026-06-28"),
      date("recent_start", "Recent start", "2026-06-29"),
      date("recent_end", "Recent end", "2026-07-05"),
    ],
  },
  {
    name: "Subject Line Open-Rate Analysis",
    description:
      "Sorts campaigns by open rate and extracts subject-line patterns that drive (or kill) opens.",
    promptTemplate: `Analyse subject-line effectiveness for the active brand between {{start_date}} and {{end_date}}.

Call sendpulseCampaigns for the range. List each campaign's subject line with its open rate, sorted highest to lowest. Then identify patterns: what do the top-opening subjects share (length, emoji, urgency, personalization, offer framing) vs the lowest? Finish with 3–5 concrete subject-line recommendations for the next sends, each tied to evidence from the data.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("start_date", "Start date", "2026-06-01"),
      date("end_date", "End date", "2026-06-30"),
      notes,
    ],
  },
  {
    name: "Deliverability & List Health",
    description:
      "Delivered vs bounced and unsubscribe trends per campaign; flags anything hurting sender reputation.",
    promptTemplate: `Assess deliverability and list health for the active brand between {{start_date}} and {{end_date}}.

Call sendpulseEmailSummary for period bounceRate and unsubscribeRate (report verbatim), then sendpulseCampaigns for per-campaign detail. Build a table: campaign, sent, delivered, bounced, unsubscribed. Flag any campaign with an unusually high bounce or unsubscribe count relative to the others. Explain the reputation risk in plain terms and give a prioritized list of remediation actions (list hygiene, re-engagement, cadence) if any metric looks unhealthy.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("start_date", "Start date", "2026-06-01"),
      date("end_date", "End date", "2026-06-30"),
      notes,
    ],
  },
  {
    name: "Monthly Newsletter Summary",
    description:
      "Stakeholder-ready month rollup: headline metrics, top campaigns, and the month's story.",
    promptTemplate: `Write a stakeholder-ready monthly email summary for the active brand covering {{start_date}} to {{end_date}}.

Call sendpulseEmailSummary for the month headline (campaigns, delivered, openRate, ctr, clickToOpenRate, unsubscribeRate — verbatim). Call sendpulseCampaigns and surface the top 3 campaigns by open rate and top 3 by CTR. Write it as a concise executive update: one headline paragraph with the numbers, a short "what drove it" section, and one clear recommendation for next month. Keep it skimmable — this goes to leadership.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      date("start_date", "Month start", "2026-06-01"),
      date("end_date", "Month end", "2026-06-30"),
      notes,
    ],
  },
];

async function main() {
  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, TEAM_SLUG),
  });
  if (!team) throw new Error(`Team "${TEAM_SLUG}" not found — run db:seed first.`);

  for (const r of reports) {
    const values = {
      teamId: team.id,
      name: r.name,
      description: r.description,
      promptTemplate: r.promptTemplate,
      inputFields: r.inputFields,
      model: MODEL,
      renderAs: "report",
      isActive: true,
    };
    const existing = await db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.teamId, team.id), eq(taskTemplates.name, r.name)),
    });
    if (existing) {
      await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, existing.id));
      console.log("Updated:", r.name);
    } else {
      await db.insert(taskTemplates).values(values);
      console.log("Created:", r.name);
    }
  }
  console.log(`\nDone — ${reports.length} SendPulse report templates upserted to "${TEAM_SLUG}".`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
