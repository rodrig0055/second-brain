import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, teams } from "../src/db/schema";
import type { TemplateInputField } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Tool orchestration + reasoning, so use the same model as the other data-tool SEO skills.
const MODEL = "anthropic/claude-sonnet-5";
const NAME = "Blog Ideas Research";

const PROMPT = `You are the SEO content strategist for the active brand. Your job is to map what the brand ALREADY has content for, mine what competitors cover and what real search demand exists, and produce a prioritized list of blog post ideas that fill the GAPS — the topics we're lacking. Everything must be grounded in REAL data: never invent search volumes, difficulty, traffic, or ranking positions.

Run mode: {{mode}}  (gap = auto-discover what we're missing from our own content + competitors; seed = work from the seed topics below; both = do both)
Seed topics / themes (used in seed/both mode): {{seed_topics}}
Extra competitor domains to mine (optional — the brand's configured competitors from the context above are used automatically): {{extra_competitors}}
Audience / angle notes (optional): {{audience_notes}}
Number of ideas to return: {{num_ideas}}

Determine the brand's primary market as an ISO 2-letter country code from the brand context and domain above (e.g. a .ph domain → "ph", a .sg domain → "sg"). Use that market code wherever a country is needed in the tool calls below, and state which market you used.

Interpretation rules:
- If "{{num_ideas}}" is "(not provided)", default to 15 ideas.
- If "{{seed_topics}}" is "(not provided)", operate purely in gap-discovery mode regardless of the run mode above.

TOOL BUDGET: you have a small number of tool calls — aim for 7 or fewer total. Prioritize the calls below and skip the least useful ones if you're running low. If a tool errors or returns zero rows, SAY SO plainly and continue with what you have — do NOT fabricate numbers.

STEP 1 — What we already have (own content inventory). ALWAYS run this.
- Call queryGsc with dimensions ["page"], a recent ~90-day date range, minImpressions 20, orderBy clicks desc (fall back to impressions), limit 200. This is our existing content inventory — the URLs/topics we already rank for.
- Call queryGsc with dimensions ["query"], the same date range, minImpressions 20, maxPosition 20, orderBy impressions desc, limit 200 — the queries we already get traction on, and where we sit in "striking distance" (positions 11–20).

STEP 2 — What competitors cover. Use the brand's competitor domains from the context above, plus any listed in "{{extra_competitors}}". For up to the 2–3 most relevant competitors, call ahrefsRequest endpoint "site-explorer/top-pages" with params: target "<competitor domain>", country "<brand market code>", select "url,keyword,traffic,top_keyword", order_by "traffic:desc", limit 50 — their best content pages and the keywords driving them.

STEP 3 — Size the demand / expand topics (Ahrefs keywords).
- In seed/both mode: for each seed topic call ahrefsRequest "keywords-explorer/matching-terms" with params keywords "<seed>", country "<brand market code>", select "keyword,volume,difficulty,parent_topic", order_by "volume:desc", limit 100. Call it once more with terms "questions" for blog/FAQ angles.
- In gap mode: take the strongest competitor keywords/topics from Step 2 and validate their demand with ahrefsRequest "keywords-explorer/overview" (or "keywords-explorer/matching-terms") for the top few.

STEP 4 — Gap analysis & synthesis. Compare the demand + competitor coverage against our own inventory from Step 1. Classify every candidate topic:
- MISSING — real demand and/or a competitor ranks for it, but we have no page covering it.
- WEAK — we have impressions/rank but poorly (striking distance, positions ~11–30) — refresh or expand what exists.
- COVERED — we already rank well; DROP it (never propose a duplicate of something we already own).
Cluster keywords into distinct blog post ideas (one idea per search intent — never two posts that would compete for the same term). Discard off-topic terms that don't fit what this brand actually sells (e.g. "marriage" for a gifting brand) and say you discarded them.

OUTPUT (markdown):
1. "What we already have" — 3–6 bullets summarizing the topic areas our existing content covers (from Step 1), citing a few real pages/queries.
2. Gap table of the top {{num_ideas}} ideas:
| # | Working title | Primary keyword | Volume | KD | Status (Missing / Weak p.X) | Competitor(s) covering it | Intent | Secondary keywords / questions | Angle for this brand | Priority |
Rank by opportunity: proven brand demand (striking distance) > competitor-validated + healthy volume × low difficulty > strong topical fit for this brand.
3. "Quick wins" — 2–3 ideas where we already have striking-distance impressions in GSC (cite the real impressions/position).
4. "Notes" — data gaps, seed topics or competitors that returned little, and anything you discarded as off-brand.

Use the active brand's voice, market, and offer from the brand context above. Keep every idea relevant to what this brand actually sells.`;

const inputFields: TemplateInputField[] = [
  {
    name: "mode",
    label: "Mode — gap: find what we're missing · seed: from your topics · both",
    type: "select",
    options: ["gap", "seed", "both"],
    required: true,
  },
  {
    name: "seed_topics",
    label: "Seed topics / themes (one per line or comma-separated) — used in seed/both mode",
    type: "textarea",
    required: false,
    placeholder: "anniversary gifts\nbirthday flowers\ncorporate gifting",
  },
  {
    name: "extra_competitors",
    label: "Extra competitor domains (optional — the brand's configured competitors are used automatically)",
    type: "text",
    placeholder: "competitor.com, another.com",
  },
  {
    name: "audience_notes",
    label: "Audience / angle notes (optional)",
    type: "textarea",
    placeholder: "gift-buyers researching occasions; prioritize buying-guide intent",
  },
  {
    name: "num_ideas",
    label: "Number of ideas to return",
    type: "text",
    placeholder: "15",
  },
];

async function main() {
  const seo = await db.query.teams.findFirst({ where: eq(teams.slug, "seo") });
  if (!seo) throw new Error("SEO team not found — run db:seed first.");

  const values = {
    teamId: seo.id,
    name: NAME,
    description:
      "Blog content ideas from a have-vs-lacking gap analysis: maps what the brand already ranks for (Search Console), mines competitor coverage (Ahrefs) and real demand, and surfaces the topics we're missing. Auto-uses the brand's configured competitors. Run in gap, seed, or both mode. Pick the brand at run time.",
    promptTemplate: PROMPT,
    inputFields,
    model: MODEL,
    isActive: true,
  };

  const existing = await db.query.taskTemplates.findFirst({
    where: and(eq(taskTemplates.teamId, seo.id), eq(taskTemplates.name, NAME)),
  });

  if (existing) {
    await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, existing.id));
    console.log("Updated existing template:", NAME);
  } else {
    await db.insert(taskTemplates).values(values);
    console.log("Created template:", NAME, "(SEO team)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
