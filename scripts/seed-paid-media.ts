import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  departments,
  knowledgeDocs,
  taskTemplates,
  teams,
  type TemplateInputField,
} from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const MODEL = "anthropic/claude-sonnet-5";

// ---- The Google Ads team ----
// Renamed from "paid-media" (scripts/rename-team-slug.ts). Kept in step here so
// a re-run updates that team instead of creating a second one beside it.
const TEAM = { slug: "google-ads", name: "Google Ads" };

// ---- Strategy playbooks (the "skills" knowledge layer) ----
// These load into the system prompt for every Paid Media chat + task run.
const PLAYBOOKS: { title: string; content: string }[] = [
  {
    title: "Paid Media operating principles",
    content: `# Paid Media — how this agent works

You are a senior paid-media analyst for the group's ad accounts (Meta + Google Ads).
You have READ-ONLY data tools that read our synced metrics — you never edit a live account.
Your job is to surface findings and propose actions; a human decides and executes.

## Tools you can call
- Meta: \`metaSpend\`, \`metaCampaignPerformance\`, \`metaCreativeFatigue\`.
- Google Ads: \`googleAdsSpend\`, \`googleAdsCampaignPerformance\`, \`googleAdsWastedSearchTerms\`.
All take an inclusive YYYY-MM-DD date range and are bound to the selected brand.

## Operating rules
- Always pull the numbers with a tool before making a claim. Never invent metrics.
- Lead with the decision/recommendation, then the evidence, then caveats.
- Money is in the account's own currency (PHP for the .ph brands). State the currency.
- When you flag wasted spend or fatigue, quantify it and rank by impact.
- Distinguish "enough spend to judge" from "too early to tell". Don't kill on thin data.
- The human owns the call on what to scale, kill, or exclude. You propose; they decide.`,
  },
  {
    title: "The 5-stage demand engine (budget allocation)",
    content: `# Budget allocation — the 5-stage demand engine

Replace the old TOFU/MOFU/BOFU funnel. Allocate and read performance by stage:

1. **Category creation** — make people want the outcome (broad reach, video). Judge on reach/CPM, view-through, assisted conversions — not last-click ROAS.
2. **Demand capture** — catch people already searching (Google Search, branded + high-intent). Judge on ROAS/CPA directly; this should be the most efficient spend.
3. **Retargeting / consideration** — warm audiences, dynamic product ads. Watch frequency and incrementality, not just ROAS (it cannibalizes organic).
4. **Conversion** — offers, urgency, abandoned-cart. Judge on CPA and incremental orders.
5. **Retention / LTV** — existing customers (often email/CRM, not paid).

When reviewing an account, map spend to these stages before judging efficiency: a high CPA in stage 1 is fine; a high CPA in stage 2 is a problem.`,
  },
  {
    title: "Meta read-only audit checklist",
    content: `# Meta Ads — what to check (read-only)

- **Spend pacing**: is daily spend tracking to the monthly target? (\`metaSpend\`)
- **Wasted spend**: campaigns with spend and ZERO conversions. (\`metaCampaignPerformance\`)
- **Efficiency**: ROAS and CPA by campaign vs the target. Rank winners and losers.
- **Creative fatigue**: ads whose CTR is falling or frequency ≥3. (\`metaCreativeFatigue\`)
- **Audience saturation**: high frequency on warm audiences → rotate creative or widen.
- **Concentration risk**: is spend over-concentrated in one ad/audience?

Output: ranked findings, each with the number, the likely cause, and a proposed action
(rotate creative, exclude audience, shift budget) for a human to approve.`,
  },
  {
    title: "Google Ads read-only audit checklist",
    content: `# Google Ads — what to check (read-only)

- **Wasted search terms**: queries that spent money with ZERO conversions — the
  negative-keyword candidates. (\`googleAdsWastedSearchTerms\`) Rank by wasted spend.
- **Campaign efficiency**: ROAS/CPA by campaign; flag zero-conversion spenders.
  (\`googleAdsCampaignPerformance\`)
- **Spend pacing**: is spend tracking to target? (\`googleAdsSpend\`)
- **Intent first**: Search should capture existing demand efficiently before
  Performance Max / Display try to create it.

When you propose negative keywords, give the exact term list grouped by the campaign
it appeared in, so a human can paste them in after approving.`,
  },
  {
    title: "The weekly operating ritual",
    content: `# Weekly paid-media ritual

Run this once a week per brand, in one pass:
1. Pull this week's Google search terms → list zero-conversion queries to exclude.
2. Check every Meta campaign for creative fatigue (dropping CTR / high frequency).
3. Review budget pacing across platforms → flag anything over/under target.
4. Compare this week to last → say what moved and what you'd do about it.

The value is consistency: the same checks every week, never skipped. Surface the
findings; the human approves the edits. Writes to live accounts are NOT enabled in v1.`,
  },
];

// ---- The job templates (read-only subset of the 12 jobs) ----
const dateFields: TemplateInputField[] = [
  { name: "start_date", label: "Start date (YYYY-MM-DD)", type: "text", required: true, placeholder: "2026-06-01" },
  { name: "end_date", label: "End date (YYYY-MM-DD)", type: "text", required: true, placeholder: "2026-06-30" },
];

const TEMPLATES: {
  name: string;
  description: string;
  promptTemplate: string;
  inputFields: TemplateInputField[];
}[] = [
  {
    name: "Wasted search spend audit (Google)",
    description:
      "Finds Google Ads search terms that spent money with zero conversions and proposes a negative-keyword list. Read-only.",
    promptTemplate: `Audit wasted search spend for this brand from {{start_date}} to {{end_date}}.

Call \`googleAdsWastedSearchTerms\` for the range. Then:
1. Report total wasted spend and the count of zero-conversion terms.
2. List the top wasted terms (term, clicks, wasted spend, which campaign(s)).
3. Propose a negative-keyword list grouped by campaign, ready to paste after approval.
4. Note any term that looks like it might be a false negative (e.g. brand/research queries worth keeping).`,
    inputFields: dateFields,
  },
  {
    name: "Meta creative fatigue check",
    description:
      "Flags Meta ads whose CTR is dropping or whose frequency is too high, and recommends what to rotate. Read-only.",
    promptTemplate: `Check this brand's Meta ads for creative fatigue from {{start_date}} to {{end_date}}.

Call \`metaCreativeFatigue\` for the range. Then:
1. List the fatigued ads (CTR first half → second half, % change, avg frequency).
2. Explain which are fatigue (falling CTR) vs saturation (high frequency).
3. Recommend, per ad, whether to refresh creative, widen the audience, or pause — for a human to approve.
4. Call out anything with too little data to judge yet.`,
    inputFields: dateFields,
  },
  {
    name: "Campaign performance audit (Meta + Google)",
    description:
      "Ranks campaigns by spend across Meta and Google, surfaces ROAS/CPA and zero-conversion spenders. Read-only.",
    promptTemplate: `Audit campaign performance for this brand from {{start_date}} to {{end_date}}, target CPA/ROAS: {{target}}.

Call \`metaCampaignPerformance\` and \`googleAdsCampaignPerformance\` for the range.
1. For each platform, rank campaigns by spend with ROAS and CPA.
2. Flag every campaign that spent with ZERO conversions (wasted spend) and total it.
3. Compare each campaign against the stated target; mark scale / hold / kill candidates.
4. Map campaigns to the 5-stage demand engine before judging efficiency (a high CPA in category-creation is acceptable; in demand-capture it is not).
Give a clear, ranked action list for a human to approve.`,
    inputFields: [
      ...dateFields,
      { name: "target", label: "Target CPA or ROAS", type: "text", placeholder: "ROAS ≥ 3, or CPA ≤ ₱400" },
    ],
  },
  {
    name: "Budget pacing check (Meta + Google)",
    description:
      "Checks spend pacing against a monthly target across platforms and flags over/under-spend. Read-only.",
    promptTemplate: `Check budget pacing for this brand from {{start_date}} to {{end_date}}. Monthly budget target: {{monthly_budget}}.

Call \`metaSpend\` and \`googleAdsSpend\` for the range.
1. Report spend by platform and combined, plus blended ROAS and conversions.
2. Compute the implied monthly run-rate and compare to the target — flag over/under pace.
3. Note any day with an unusual spike or drop in spend.
4. Recommend whether to adjust budgets, and where, for a human to approve.`,
    inputFields: [
      ...dateFields,
      { name: "monthly_budget", label: "Monthly budget target", type: "text", placeholder: "₱500,000 total across platforms" },
    ],
  },
  {
    name: "Weekly paid-media review (all platforms)",
    description:
      "Runs the full weekly ritual: wasted spend, creative fatigue, pacing, and week-over-week movement. Read-only. Good for a weekly schedule.",
    promptTemplate: `Run the weekly paid-media review for this brand. This week: {{this_week}}. Last week (for comparison): {{last_week}}.

Use the tools for both date ranges as needed:
1. Wasted spend — Google zero-conversion search terms (\`googleAdsWastedSearchTerms\`) + zero-conversion campaigns on both platforms.
2. Creative fatigue — Meta ads with dropping CTR / high frequency (\`metaCreativeFatigue\`).
3. Budget pacing — spend by platform vs run-rate (\`metaSpend\`, \`googleAdsSpend\`).
4. Week-over-week — compare this week to last; say what moved (spend, ROAS, CPA, conversions) and why it likely moved.
Finish with a prioritized action list (most impact first), each marked as a proposal for human approval. Do not claim any edits were made — writes are not enabled.`,
    inputFields: [
      { name: "this_week", label: "This week (YYYY-MM-DD to YYYY-MM-DD)", type: "text", required: true, placeholder: "2026-06-23 to 2026-06-29" },
      { name: "last_week", label: "Last week (YYYY-MM-DD to YYYY-MM-DD)", type: "text", required: true, placeholder: "2026-06-16 to 2026-06-22" },
    ],
  },
];

async function main() {
  // 1. Team (under Marketing).
  const marketing = await db.query.departments.findFirst({
    where: eq(departments.slug, "marketing"),
  });
  if (!marketing) throw new Error("Marketing department not found — run db:seed first.");

  await db
    .insert(teams)
    .values({ slug: TEAM.slug, name: TEAM.name, departmentId: marketing.id })
    .onConflictDoNothing();
  const team = await db.query.teams.findFirst({ where: eq(teams.slug, TEAM.slug) });
  if (!team) throw new Error("Failed to create paid-media team.");
  console.log(`✓ team: ${team.name} (${team.id})`);

  // 2. Playbooks (brand-wide: brandId null, scoped to the team).
  for (const p of PLAYBOOKS) {
    const existing = await db.query.knowledgeDocs.findFirst({
      where: and(eq(knowledgeDocs.teamId, team.id), eq(knowledgeDocs.title, p.title)),
    });
    if (existing) {
      await db
        .update(knowledgeDocs)
        .set({ content: p.content, isActive: true, updatedAt: new Date() })
        .where(eq(knowledgeDocs.id, existing.id));
      console.log(`  ↻ playbook: ${p.title}`);
    } else {
      await db.insert(knowledgeDocs).values({
        teamId: team.id,
        kind: "playbook",
        title: p.title,
        content: p.content,
        isActive: true,
      });
      console.log(`  + playbook: ${p.title}`);
    }
  }

  // 3. Job templates.
  for (const t of TEMPLATES) {
    const existing = await db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.teamId, team.id), eq(taskTemplates.name, t.name)),
    });
    const values = {
      teamId: team.id,
      name: t.name,
      description: t.description,
      promptTemplate: t.promptTemplate,
      inputFields: t.inputFields,
      model: MODEL,
      isActive: true,
    };
    if (existing) {
      await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, existing.id));
      console.log(`  ↻ template: ${t.name}`);
    } else {
      await db.insert(taskTemplates).values(values);
      console.log(`  + template: ${t.name}`);
    }
  }

  console.log("Done. Connect Meta/Google Ads under /admin/integrations, then run the templates under /t/paid-media/tasks.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
