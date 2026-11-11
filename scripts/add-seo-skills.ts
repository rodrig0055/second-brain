import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, teams } from "../src/db/schema";
import type { TemplateInputField } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const MODEL = "anthropic/claude-sonnet-5";

// Reused input fields ------------------------------------------------------
const startDate = (placeholder = "2025-01-01"): TemplateInputField => ({
  name: "start_date",
  label: "Start date (YYYY-MM-DD)",
  type: "text",
  required: true,
  placeholder,
});
const endDate = (placeholder = "2025-01-28"): TemplateInputField => ({
  name: "end_date",
  label: "End date (YYYY-MM-DD)",
  type: "text",
  required: true,
  placeholder,
});
const minImpr = (def = "50"): TemplateInputField => ({
  name: "min_impressions",
  label: "Minimum impressions per row",
  type: "text",
  placeholder: def,
});
const notes: TemplateInputField = {
  name: "notes",
  label: "Extra notes / focus (optional)",
  type: "textarea",
};

const DATA_RULES =
  "Always use the tools to fetch REAL numbers for the active brand — never invent metrics. " +
  "If a tool returns an error or zero rows, say so plainly and stop rather than guessing. " +
  "Cite the actual clicks / impressions / position values you retrieved.";

type Skill = {
  name: string;
  description: string;
  promptTemplate: string;
  inputFields: TemplateInputField[];
};

const skills: Skill[] = [
  {
    name: "Cannibalization Finder",
    description:
      "Flags queries where two or more URLs compete, grouped and ready to consolidate. Uses live GSC data.",
    promptTemplate: `Find keyword cannibalization for the active brand between {{start_date}} and {{end_date}}.

Call queryGsc with dimensions ["query","page"], minImpressions {{min_impressions}}, orderBy impressions desc, limit 1000.
Then group the rows by query and keep only queries served by 2+ different URLs.

For each cannibalized query, show: the query, each competing URL with its clicks/impressions/position, and a recommendation (which URL to keep as canonical, which to consolidate/redirect/de-optimize, and why — based on the real numbers). Sort by total impressions at risk. End with a short prioritized action list.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [startDate(), endDate(), minImpr("100"), notes],
  },
  {
    name: "Striking Distance Decoder",
    description:
      "Surfaces position 11–20 keywords with real traffic upside, ranked by opportunity.",
    promptTemplate: `Find striking-distance keywords (avg position 11–20) for the active brand between {{start_date}} and {{end_date}}.

Call queryGsc with dimensions ["query","page"], minPosition 11, maxPosition 20, minImpressions {{min_impressions}}, orderBy impressions desc, limit 500.

Return a ranked table: query, page, impressions, current position, current CTR, and an estimated clicks upside if it moved to the top of page 1 (reason from the impressions). Group by the page that should be optimized. For the top 10 opportunities, add one concrete on-page action each.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [startDate(), endDate(), minImpr("100"), notes],
  },
  {
    name: "Decay Scanner",
    description:
      "Catches pages with clicks down 20%+ from a baseline period before they fall off page one.",
    promptTemplate: `Detect content decay for the active brand.

Baseline (healthy) period: {{baseline_start}} to {{baseline_end}}
Recent period: {{recent_start}} to {{recent_end}}

Call compareGscPeriods with groupBy "page", the two date ranges above, minImpressions {{min_impressions}}, orderBy clicksDelta asc.
Flag pages whose clicks dropped by {{drop_threshold}}% or more, OR whose average position got materially worse (positive positionDelta).

For each decaying page list: baseline vs recent clicks, % change, position change. Then give the top 10 a likely cause (ranking loss, seasonality, SERP change) and a refresh action. Sort by absolute clicks lost.

${DATA_RULES}`,
    inputFields: [
      { name: "baseline_start", label: "Baseline start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2024-10-01" },
      { name: "baseline_end", label: "Baseline end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2024-10-28" },
      { name: "recent_start", label: "Recent start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-01" },
      { name: "recent_end", label: "Recent end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-28" },
      { name: "drop_threshold", label: "Click-drop threshold %", type: "text", placeholder: "20" },
      minImpr("50"),
    ],
  },
  {
    name: "Intent Mismatch Auditor",
    description:
      "Finds a page ranking for queries it doesn't actually answer, and the traffic it's costing.",
    promptTemplate: `Audit search-intent match for this page: {{page_url}}

The page's fetched content is appended below. Also call queryGsc with dimensions ["query"], containsPage "{{page_url}}", date range {{start_date}} to {{end_date}}, minImpressions {{min_impressions}}, orderBy impressions desc, limit 200.

Compare the queries the page actually ranks for against what the page content delivers. Identify: (1) queries with high impressions but low CTR/position where the intent is mismatched, (2) the dominant intent the page should serve, (3) the traffic cost of the mismatch (impressions not converting to clicks). Recommend whether to re-optimize this page, split it, or create a new page — with specifics.

${DATA_RULES}`,
    inputFields: [
      { name: "page_url", label: "Page URL to audit", type: "text", required: true, placeholder: "https://acmeflorals.example/collections/birthday" },
      startDate(),
      endDate(),
      minImpr("20"),
    ],
  },
  {
    name: "Internal Link Reallocator",
    description:
      "\"Push authority from A to B\" — backed by real GSC numbers, not a guess.",
    promptTemplate: `Recommend internal links to push authority toward this target page: {{target_url}}
Topic / keyword theme: {{topic}}

Call queryGsc with dimensions ["page","query"], containsQuery "{{topic}}", date range {{start_date}} to {{end_date}}, minImpressions {{min_impressions}}, orderBy clicks desc, limit 500.

Identify the brand's strongest pages on this topic (high clicks/impressions) — these are the authority sources. Then recommend internal links FROM those source pages TO {{target_url}}, with suggested anchor text drawn from the real queries each source ranks for. Show the supporting numbers for each source. Flag if the target itself is already the strongest page (then reallocation isn't needed).

${DATA_RULES}`,
    inputFields: [
      { name: "target_url", label: "Target URL to boost", type: "text", required: true, placeholder: "https://acmeflorals.example/collections/anniversary" },
      { name: "topic", label: "Topic / keyword theme", type: "text", required: true, placeholder: "anniversary" },
      startDate(),
      endDate(),
      minImpr("20"),
    ],
  },
  {
    name: "SERP Spy",
    description:
      "Pulls a competitor's ranking pages for a topic, grouped by intent and format. Uses Ahrefs.",
    promptTemplate: `Analyze competitor {{competitor_domain}} for the topic "{{topic}}".

Use ahrefsRequest to gather data:
- endpoint "site-explorer/top-pages" with params { target: "{{competitor_domain}}", country: "{{country}}" } to see their best pages.
- endpoint "site-explorer/organic-keywords" with params { target: "{{competitor_domain}}", country: "{{country}}" } filtered/scanned for the topic.
(Provide the required Ahrefs params including a recent date and a sensible select/limit.)

Group their ranking pages by search intent (informational / commercial / transactional) and content format (category, blog, guide, product). Identify the topics/formats where they win and the brand likely doesn't. End with 5 concrete content opportunities ranked by estimated value.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [
      { name: "competitor_domain", label: "Competitor domain", type: "text", required: true, placeholder: "competitor.com" },
      { name: "topic", label: "Topic", type: "text", required: true, placeholder: "anniversary gifts" },
      { name: "country", label: "Country code", type: "text", placeholder: "ph" },
      notes,
    ],
  },
  {
    name: "Weekly Report Writer",
    description:
      "Client-ready weekly SEO report: clicks, impressions, top movers, and three priorities.",
    promptTemplate: `Write a client-ready weekly SEO report for the active brand.

This week: {{recent_start}} to {{recent_end}}
Last week: {{baseline_start}} to {{baseline_end}}

Call compareGscPeriods twice if helpful — once groupBy "page" and once groupBy "query" — across the two periods above (minImpressions 20). Also call queryGsc for whole-period totals if you need the headline numbers.

Produce: (1) a headline summary (total clicks, impressions, avg position this week vs last, with % change); (2) Top 5 gainers and Top 5 losers (pages and queries) with the real numbers; (3) exactly three prioritized actions for next week, each justified by the data. Keep it concise and presentation-ready — no jargon.

${DATA_RULES}`,
    inputFields: [
      { name: "recent_start", label: "This week start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-22" },
      { name: "recent_end", label: "This week end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-28" },
      { name: "baseline_start", label: "Last week start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-15" },
      { name: "baseline_end", label: "Last week end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-21" },
    ],
  },
  {
    name: "Query Clustering",
    description:
      "Groups thousands of queries into search-intent clusters that map to real pages.",
    promptTemplate: `Cluster the active brand's search queries into intent-based topic clusters for {{start_date}} to {{end_date}}.

Call queryGsc with dimensions ["query","page"], minImpressions {{min_impressions}}, orderBy impressions desc, limit 1000.

Group the queries into coherent topic/intent clusters. For each cluster give: a cluster label, the dominant intent, total clicks & impressions, the page(s) currently capturing it, and whether one canonical page owns the cluster or it's fragmented. Flag clusters with strong demand but no clear owning page (content gaps). Sort clusters by total impressions.

Extra focus: {{notes}}

${DATA_RULES}`,
    inputFields: [startDate(), endDate(), minImpr("50"), notes],
  },
  {
    name: "Title Tag Doctor",
    description:
      "Finds weak titles, missing keywords and CTR leaks, with data-backed rewrites.",
    promptTemplate: `Diagnose title-tag / CTR problems for the active brand between {{start_date}} and {{end_date}}.

Call queryGsc with dimensions ["page","query"], minImpressions {{min_impressions}}, orderBy impressions desc, limit 500.
Find pages with strong impressions and decent position (top ~10) but below-expected CTR — these are CTR leaks. {{page_url}} — if a specific page URL is provided here, also use its fetched content (appended below) to read the current title/H1.

For each problem page list: the page, top queries, impressions, position, current CTR vs a reasonable benchmark for that position, and the likely cause (missing keyword, weak/duplicate title, no value prop). Then provide a rewritten title tag (<60 chars) and meta description (<155 chars) using the real high-impression queries. Prioritize by potential clicks recovered.

${DATA_RULES}`,
    inputFields: [
      startDate(),
      endDate(),
      minImpr("100"),
      { name: "page_url", label: "Specific page URL to inspect (optional)", type: "text", placeholder: "https://acmeflorals.example/collections/birthday" },
    ],
  },
  {
    name: "Ranking Anomaly Alerts",
    description:
      "Flags unusual ranking drops or spikes fast, so you can act before traffic moves.",
    promptTemplate: `Detect ranking anomalies for the active brand.

Compare a recent window against the preceding baseline:
Baseline: {{baseline_start}} to {{baseline_end}}
Recent: {{recent_start}} to {{recent_end}}

Call compareGscPeriods groupBy "page" and again groupBy "query" across those windows (minImpressions {{min_impressions}}). Flag anomalies where clicks, impressions, or position changed by more than the sensitivity threshold of {{sensitivity}}% (or a large absolute position swing).

Separate DROPS (act now) from SPIKES (capitalize). For each anomaly: the page/query, the metric that moved, before→after values, and a hypothesis (algo update, SERP feature, seasonality, technical issue). End with an urgent-action shortlist.

${DATA_RULES}`,
    inputFields: [
      { name: "baseline_start", label: "Baseline start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-08" },
      { name: "baseline_end", label: "Baseline end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-14" },
      { name: "recent_start", label: "Recent start (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-15" },
      { name: "recent_end", label: "Recent end (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-01-21" },
      { name: "sensitivity", label: "Sensitivity threshold %", type: "text", placeholder: "25" },
      minImpr("50"),
    ],
  },
];

async function main() {
  const seo = await db.query.teams.findFirst({ where: eq(teams.slug, "seo") });
  if (!seo) throw new Error("SEO team not found — run db:seed first.");

  for (const skill of skills) {
    const values = {
      teamId: seo.id,
      name: skill.name,
      description: skill.description,
      promptTemplate: skill.promptTemplate,
      inputFields: skill.inputFields,
      model: MODEL,
      isActive: true,
    };
    const existing = await db.query.taskTemplates.findFirst({
      where: and(eq(taskTemplates.teamId, seo.id), eq(taskTemplates.name, skill.name)),
    });
    if (existing) {
      await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, existing.id));
      console.log("Updated:", skill.name);
    } else {
      await db.insert(taskTemplates).values(values);
      console.log("Created:", skill.name);
    }
  }
  console.log(`\nDone — ${skills.length} SEO skill templates upserted.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
