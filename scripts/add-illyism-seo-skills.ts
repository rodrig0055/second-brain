/**
 * Seeds six SEO / content skills, adapted from Illyism/seo-skills (MIT,
 * https://github.com/Illyism/seo-skills), as `kind: "skill"` knowledge docs on
 * the SEO team. They are global (null brand), so every brand's SEO chat lists
 * them in its Skills index and the agent pulls the body with load_skill.
 *
 * Adapted, not copied: tool steps name this app's tools (queryGsc,
 * compareGscPeriods, ahrefsRequest, fetchWebPage, searchWeb, storefront*), the
 * storefronts are CMS/Shopify (so output is an edit list, not a code change),
 * and the upstream vendor plugs (LinkDR, AI SEO Tracker) are removed.
 *
 * Idempotent: upserts on (teamId = seo, brandId IS NULL, slug).
 *
 *   set -a && . ./.env.local && set +a && npx tsx scripts/add-illyism-seo-skills.ts [--dry]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { knowledgeDocs, teams } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
const DRY = process.argv.includes("--dry");

const SOURCE = "https://github.com/Illyism/seo-skills";

const DATA_RULES = `## Data rules
- Pull real numbers with the tools for the active brand. Never invent a metric, statistic, price, review or quote.
- If a tool errors or returns nothing, say so plainly and continue with what you have. Never fill the gap with a guess.
- Cite where each number came from (queryGsc, Ahrefs, the fetched page) and the date range.
- searchWeb may be unavailable. For "what ranks" use ahrefsRequest 'serp-overview/serp-overview' with keyword, country, date (yesterday) and select "position,url,title,domain_rating,traffic", then fetchWebPage the result URLs.
- Every Ahrefs site-explorer and serp-overview call needs both \`select\` and \`date\`. organic-keywords columns are best_position and sum_traffic (not position or traffic); for a single URL pass mode "exact".
- Before you name a product with a price, or put it in a budget tier, look up its current price with storefrontProducts (search by the product's name). A product whose price you did not check does not go in a price table.
- Never write an offer or commitment into any copy, title, meta description or recommendation (free delivery, discounts, sizes, MOQs, turnaround, free mock-ups, guaranteed dates, payment terms) unless the fetched page or the brand's offer rules state it. If it would help but is unconfirmed, list it as a question for the owner instead.
- If fetchWebPage fails on a page, say so, and do not describe that page's content or tag anything about it [verified].
- Never state a percentage, share or count you did not compute from tool data. Marking a made-up number [inferred] does not make it acceptable; describe the pattern in words instead.
- Before recommending a redirect or merge, say whether the page gets traffic or is a paid-ads landing page, and flag it for the owner rather than presenting it as a done decision.
- When you state a figure from a page you fetched (word count, number of items), count it from the fetched content; do not estimate it from a snippet.`;

const CMS_NOTE = `## Where changes go
The storefronts run on the in-house CMS (Shopify for Northwind Audio). You cannot edit them. Every recommendation ends as an edit list a person can apply in the CMS: the URL, the field (title tag, meta description, H1, body section, internal link) and the exact new text.`;

type Skill = {
  slug: string;
  title: string;
  trigger: string;
  tags: string[];
  content: string;
};

const skills: Skill[] = [
  {
    slug: "blog-refresher",
    title: "Blog Refresher",
    trigger:
      "Refresh an existing blog post so it outranks the pages above it: audit, SERP gap analysis, approval, then the rewrite. Use when asked to update, refresh or improve a post, recover lost rankings, or explain why a post fell behind.",
    tags: ["seo", "content", "blog"],
    content: `# Blog Refresher

You update an existing post so it outranks the pages above it. Analyze the post, compare it with what ranks, find the gaps, and write an improved version that keeps the original voice. Keep messages short until the final content.

## Inputs
The post URL (required) and its main keyword (infer it from GSC if not given).

## Phase 1: Current state
1. fetchWebPage the post. Record: title, H1, word count, H2/H3 outline, lists/tables/images, internal and external links, CTAs, visible "last updated" date.
2. queryGsc with dimensions ["query"], containsPage = the post URL, last 90 days, orderBy impressions desc. Note the primary query, position, CTR, and the secondary queries it already ranks for.
3. compareGscPeriods groupBy "page" (last 28 days vs the 28 days a quarter earlier) to see whether it is decaying.
4. Write: STRENGTHS (keep), WEAKNESSES (outdated, missing, thin), QUICK WINS.

## Phase 2: Competitor research
1. ahrefsRequest 'serp-overview/serp-overview' for the primary keyword in the brand's country. Note the top 10, the dominant format and any SERP features.
2. Pick 5 competitors (ranks 1 to 3 first, then direct competitors and recently updated pages). fetchWebPage each.
3. For each: position, word count, H2/H3 outline, unique elements (data, examples, tools, visuals), last modified.

## Phase 3: Gap analysis
Table: rows = word count, snippet format, each topic, statistics, examples, visuals, FAQ, schema; columns = this post, Comp 1 to 5, priority.
Missing topics by priority: High (4+ competitors), Medium (2 to 3), Low (1), Emerging (nobody yet). Finish with each competitor's unique angle and our chance to differentiate (real products, prices, delivery areas, local occasions only we can state).

## Phase 4: Plan
- 3 new title options (current year or new angle, snippet-focused).
- New H2 outline, each marked Keep / Modified / New.
- Target word count, new elements (table, FAQ from People Also Ask), internal links to add from our strongest related pages (from queryGsc), product/collection links.

## Phase 5: Approval (stop here)
Present: summary (ranks #X, behind on Y), key findings, gap table, new outline. Ask "Shall I write the refreshed version?" Do not promise ranking or traffic gains. Do not write the post until the user approves.

## Phase 6: Write the refresh
Keep sections that already rank, the voice, the URL and existing anchors. Add a visible "Last updated: <date>", a year next to every statistic, a snippet-ready answer in the first two sentences, 2 to 3 sentence paragraphs, more H3s, lists/tables where they help.
SEO checklist: title tag 50 to 60 chars, meta description 150 to 160, primary keyword in the first 100 words, FAQ answering People Also Ask, internal links both ways.

## Output
The full refreshed post in markdown, then a publisher block: new title tag, meta description, schema to add, internal links (from URL to URL with anchor), images needed, URL keep/redirect, word count old to new, sections added.

${CMS_NOTE}

${DATA_RULES}`,
  },
  {
    slug: "seo-title-optimization",
    title: "SEO Title Optimization",
    trigger:
      "Rewrite or audit title tags, meta titles and H1 alignment for rankings and click-through rate, for one page or in bulk. Use when the user mentions titles, title tags, SERP titles, CTR, or truncation.",
    tags: ["seo", "titles", "ctr"],
    content: `# SEO Title Optimization

Treat the SERP as the brief. Do not write titles from vibes: find the target query, study what ranks, then write the clearest title that matches the page and the intent.

## Formula
Primary keyword + modifier or benefit + brand. Examples:
- \`Same-Day Flower Delivery Manila | Acme Florals\`
- \`Corporate Gift Boxes Singapore | Bloomly\`

## Checklist (per title)
- Primary query near the front; important words visible before truncation.
- 40 to 55 characters ideal (Thai titles: aim shorter, about 45).
- Title, meta description, H1 and slug all about the same topic.
- Match the page type: collection, product, occasion, guide, listicle, comparison, how-to, definition.
- Unique across the site. No "Home", "Products" or vague category labels.
- Mirror SERP patterns when useful (best, numbers, year, same-day). No hype words (Shocking, Guaranteed) unless the SERP uses them.
- Do not change slugs for a year or a number.

## Blog patterns (pick one per page)
Beginner guide, pillar ("The Complete Guide to X"), definition ("What Is X?"), how-to ("How to X Without Y"), listicle ("15 Best X for Y in 2026"), checklist, comparison ("A vs B: which to choose"), problem ("How to Fix X").

## Workflow
1. Get the data. Single page: fetchWebPage it for the current title/H1, and queryGsc dimensions ["query"], containsPage = URL, last 90 days. Bulk: ONE queryGsc call with dimensions ["page","query"], maxPosition 10, minImpressions 100, orderBy impressions desc, limit 500. Do not query each page separately: that one call already gives every page's queries. Prioritize the 5 to 8 pages in the top 10 with CTR furthest below what their position should earn, and stop researching there.
2. Determine intent and the primary query (the highest-impression query that matches what the page delivers).
3. ahrefsRequest 'serp-overview/serp-overview' for that query (bulk: only for the top 3 to 4 pages); note repeated structures, modifiers and length in the top titles. Current titles: the serp-overview result lists titles; fetchWebPage only if a page's title is not there.
Keep the whole run under about 10 tool calls, then write the table.
4. Draft 3 to 5 options, pick the most accurate one that earns the click, and give a matching meta description (under 155 chars).

## Bulk output
| Page | Current title | Suggested title | Why (with the query, impressions, position, CTR) |
Keep reasons short so the user can approve quickly.

${CMS_NOTE}

${DATA_RULES}`,
  },
  {
    slug: "customer-journey",
    title: "Customer Journey",
    trigger:
      "Map how customers discover, evaluate and choose the brand across Google, AI chatbots (ChatGPT, Gemini, Perplexity) and social, with the 5-stage awareness journey and the real prompts people type at each stage. Use for search intent, AI SEO prompts, buyer journeys, or what content to create.",
    tags: ["seo", "ai-seo", "intent", "content-strategy"],
    content: `# Customer Journey

Map how this brand's customers discover, evaluate and choose across search engines, AI chatbots and social (TikTok, Facebook, Instagram, YouTube, Reddit). The brands here sell gifts, flowers and corporate gifting to consumers and businesses, not SaaS: think occasions, deadlines, delivery areas and budgets.

## Process
1. Context: what the brand sells, to whom, in which market (use the brand docs in your system prompt; ask only if the product or audience is unclear).
2. Light research: queryGsc dimensions ["query"], last 90 days, orderBy impressions desc, limit 300 for the real queries people already use; ahrefsRequest 'keywords-explorer/matching-terms' with terms='questions' on 2 to 3 seed terms for question queries.
3. Map the 5 stages: Unaware, Problem-Aware, Solution-Aware, Product-Aware, Most Aware.
4. For each stage give:
   - The buyer's mindset (one or two sentences).
   - 3 to 5 natural prompts they would type into Google or ChatGPT, written like a real person in this market (include local phrasing and Taglish/Thai where real). Mark any that appear in our GSC data with their impressions.
   - Content to create or improve, naming an existing URL where one already serves it.

## Output
Clean markdown, one heading per stage, then a short "biggest gaps" list: stages where demand exists (GSC or Ahrefs volume) but we have no page.

${DATA_RULES}`,
  },
  {
    slug: "understand-customers",
    title: "Understand Customers",
    trigger:
      "Research the ideal customer before writing copy: identity, pains, desires, inner monologue and their exact language, then copy angles. Use when asked about customer pain points, knowing the target, or researching the audience before writing.",
    tags: ["copywriting", "research", "audience"],
    content: `# Understand Customers

Before writing copy, build a picture of the ideal customer for the product or service the user names. Ground it in evidence where you can: search queries from queryGsc (the words people actually use), reviews or comments the user pastes, competitor pages via fetchWebPage. Label anything that is inference, not evidence.

Answer:

1. **Core identity and role.** Who are they really (e.g. "HR lead buying 200 year-end gifts on a fixed budget", "OFW sending flowers home for a birthday")? What is their main goal here?

2. **Deepest pains (the nightmare scenario).**
   - Their worst realistic outcome (late delivery on the day, a gift that looks cheap in front of the boss).
   - The exact words and phrases they use for it (quote search queries where possible).
   - Their inner monologue.
   - What they tried before that disappointed them, and why.
   - The emotional cost (embarrassment, stress, wasted budget).

3. **Unspoken desires (the magic-wand outcome).**
   - The almost too-good-to-be-true result.
   - What it means beyond the function (looking thoughtful, being the hero of the office, peace of mind).
   - What would feel like a cheat code.

4. **Language and worldview.** Their jargon, platforms and influences; one belief about the category we can affirm or challenge.

Then brainstorm copy angles: identity triggers, emotional hooks, pattern interrupts, and the payoff. Give 5 headline or hook examples in the brand voice.

${DATA_RULES}`,
  },
  {
    slug: "seo-autopilot",
    title: "SEO Autopilot Run",
    trigger:
      "Run a full SEO pass for the brand: site health, page 2 to page 1 pushes, indexing and decay checks, competitor moves, keyword map gaps, and a short report with a prioritized edit list. Use when asked for an SEO autopilot run, a weekly SEO run, or 'what should we fix in SEO now'.",
    tags: ["seo", "audit", "weekly"],
    content: `# SEO Autopilot Run

You run search for this brand end to end in one pass. The goal is more buyers from Google and AI answers who convert; traffic that never converts and word count do not count. You cannot edit the storefront, so "shipping" means a precise, prioritized edit list a person applies in the CMS. Advice without a specific URL and change is not work.

Unlike the upstream version, you keep no state between runs: start from the live data each time, and if the user pastes a previous report, diff against it.

## 1. Health check
- storefrontSitemapChanges and storefrontSummary: new, removed or changed URLs. A snapshot in status "error" is the brain's snapshot job failing, not the site: list it under "Brain data jobs failing", never under "What is broken".
- checkUrls on the sitemap and feed URLs, the homepage, and the 20 highest-click pages (queryGsc dimensions ["page"], last 28 days). Only a 4xx/5xx status, a redirect to the wrong place, or a redirect chain from checkUrls counts as broken.
- fetchWebPage the homepage and the 5 highest-click pages. Flag: missing, duplicate or cut-off titles and descriptions, wrong canonicals, stray noindex, thin or missing main content. For every internal link you report as broken, run checkUrls on the exact href first and quote the status.
- Never call a page, sitemap or feed broken because a tool errored or a fetch failed. Say "could not check" and move on.
- A checkUrls result "still behind a bot check" means OUR server was challenged; the page's real status is unknown. Do not claim search engines or visitors are blocked unless queryGsc shows that URL's impressions dropping; report it as "could not check (bot challenge)".

## 2. Page 2 to page 1
queryGsc dimensions ["query","page"], minPosition 8, maxPosition 20, minImpressions 100, last 28 days. For the top 5 by impressions: ahrefsRequest 'serp-overview/serp-overview', fetchWebPage the top 3, and say why they win (better intent match, a missing section, fresher data, more links). Then give the change: answer the query in the first paragraph, add what is missing, put the query in the title and H1 if it reads naturally, and name 2 to 3 of our stronger pages to link from, with anchor text. Good position but low CTR: rewrite the title and description instead.

## 3. Decay and anomalies
compareGscPeriods groupBy "page", last 28 days vs the previous 28, orderBy clicksDelta asc. List pages down 20%+ in clicks with a likely cause and a fix.

## 4. Keyword map gaps
From queryGsc dimensions ["query","page"] (last 90 days, limit 1000): give every important query one owning page. Two pages chasing one query is a bug (merge and redirect). Then ahrefsRequest 'keywords-explorer/matching-terms' on the 3 core category terms for the brand's country: demand with no page is a gap.

## 5. Competitors
For the 2 to 3 competitors named in your system prompt, ahrefsRequest 'site-explorer/top-pages' (country, today's date). Note pages they win with that we lack. Add a gap only where we can make a better page.

## 6. AI answers (if searchWeb works)
For 5 buyer questions a customer would ask an AI assistant, check whether the brand is named and which sources are cited. Sources that cite competitors are the outreach list. If you cannot check, say "not verified".

## Rules for anything you propose to write
- Read what ranks first. If you cannot say what our page will have that none of them has, do not propose it.
- Answer the question in the first two sentences.
- Use what only we know: real products, prices, delivery coverage, cut-off times, customer numbers from the tools.
- Every new page gets at least three internal links from existing pages, plus a title, description and structured data where it fits.

## Report (under 400 words)
1. What is broken (URL, the checkUrls status or the quoted page text that proves it, fix). Then, separately, "Brain data jobs failing" if any snapshot or tool errored.
2. What moved (clicks, impressions, positions vs the previous period, each with its source).
3. The edit list: top 10 changes ranked by expected buyer impact per hour of work, each with URL, field and exact new text.
4. At most three things you need from the owner.

## Limits
- Do not recommend deleting or redirecting a page with traffic or links without flagging it first.
- Do not change prices, offers or claims; the product is right if a page disagrees.
- Do not recommend buying links or posting on forums. Links come from pages worth citing and genuine outreach drafts.

${DATA_RULES}`,
  },
  {
    slug: "blitz-seo",
    title: "Blitz SEO Sprint",
    trigger:
      "Plan a focused 30-day sprint to rank one high-value page for one money keyword (3 max). Use when stuck on page 2 for a keyword that matters, launching a page that must win fast, or when SEO feels spread too thin.",
    tags: ["seo", "sprint", "money-keyword"],
    content: `# Blitz SEO: a 30-day sprint to rank one page

Concentrate every resource on ranking one page for one money keyword (3 max). Not scale or volume: focus, speed and pressure. Most SEO fails because it is spread too thin; you need 1 to 3 money pages in the top 3.

## Assessment
1. Money keyword candidates: high-intent, revenue-tied (e.g. "flower delivery manila", "corporate gifts singapore"). Not blog long-tails. Use queryGsc dimensions ["query","page"], last 90 days, and ahrefsRequest 'keywords-explorer/overview' for volume and difficulty.
2. Current position: a page at 5 to 20 is the ideal target (indexed, needs pressure).
3. Revenue link: would top 3 directly produce orders or leads?
4. Resources: existing posts for internal links, social accounts, PR or partner relationships.
The target test: a keyword that hurts to lose to a competitor. Do not use this for keywords with no revenue, or for a brand-new domain.

## Step 1: one keyword
Check the SERP with ahrefsRequest 'serp-overview/serp-overview'. Weaker competitors outranking us mark the target.

## Step 2: one page
fetchWebPage the page and the top 3 results. Rewrite plan: keyword in the title tag, H1, URL and meta description; related phrases in subheadings; fast and mobile-ready; visual trust (real product photos, reviews, delivery promise, corporate client logos); linked from the homepage and main nav if possible.

## Step 3: daily ritual (30 days)
- Add internal links from older posts and pages to the target (list the source pages and anchors from queryGsc).
- One on-page tweak based on SERP comparison.
- Request indexing in Search Console after meaningful changes.
- Earn links, do not buy them: draft outreach to sites that already cite competitors (from Ahrefs), partners, suppliers and local press. Share the page on our own social channels where relevant. No paid links and no forum spam: both risk penalties.
- Log every change and the daily position.

## Output
1. Recommended keyword and page, with the reasoning and numbers.
2. On-page rewrite checklist for that page (exact title, H1, meta, sections to add).
3. A 30-day calendar with the daily ritual filled in.
4. A tracking log (date, change, position, notes).
5. Expectation: movement often shows around day 14 to 20 if pressure holds; do not promise it.

${CMS_NOTE}

${DATA_RULES}`,
  },
];

async function main() {
  const seo = await db.query.teams.findFirst({ where: eq(teams.slug, "seo") });
  if (!seo) throw new Error("SEO team not found; run db:seed first.");

  for (const s of skills) {
    const values = {
      brandId: null,
      teamId: seo.id,
      kind: "skill" as const,
      title: s.title,
      slug: s.slug,
      tags: s.tags,
      metadata: { source: SOURCE, license: "MIT", adaptedFor: "second-brain" },
      content: s.content,
      triggerDescription: s.trigger,
      isActive: true,
      reviewState: "approved",
      updatedAt: new Date(),
    };
    const existing = await db.query.knowledgeDocs.findFirst({
      where: and(
        eq(knowledgeDocs.teamId, seo.id),
        isNull(knowledgeDocs.brandId),
        eq(knowledgeDocs.kind, "skill"),
        eq(knowledgeDocs.slug, s.slug),
      ),
    });
    if (DRY) {
      console.log(`${existing ? "Would update" : "Would create"}: ${s.slug} (${s.content.length} chars)`);
      continue;
    }
    if (existing) {
      await db.update(knowledgeDocs).set(values).where(eq(knowledgeDocs.id, existing.id));
      console.log("Updated:", s.slug);
    } else {
      await db.insert(knowledgeDocs).values(values);
      console.log("Created:", s.slug);
    }
  }
  console.log(`\nDone: ${skills.length} SEO skills upserted${DRY ? " (dry run)" : ""}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
