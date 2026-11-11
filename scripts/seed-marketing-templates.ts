import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, type TemplateInputField } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Cheap, fast default — matches scripts/add-seo-template.ts. Change per-template
// if a task needs more reasoning.
const MODEL = "google/gemini-3.5-flash-lite";

// A curated marketing task-template catalog (patterned on Letaido's free-tools
// list), mapped to Second Brain teams. Deliberately EXCLUDES the five templates
// db:seed already creates (SEO content brief, Social captions pack, Meta ad copy
// variants, Newsletter draft, Product listing copy). Every prompt writes in the
// active brand's voice from the brand context and defers to live data tools for
// any real numbers rather than inventing them.
type Seed = {
  teamSlug: string;
  name: string;
  description: string;
  promptTemplate: string;
  inputFields: TemplateInputField[];
};

// Shared closing rule appended to keep outputs grounded + on-brand.
const BRAND_RULE =
  "\n\nWrite in the active brand's voice, market, and USPs from the brand context above. Never invent prices, delivery times, policies, or product claims not present in the brand context — omit or keep general instead. Output only the requested artifact with no preamble.";

const TEMPLATES: Seed[] = [
  // ---------------- SEO ----------------
  {
    teamSlug: "seo",
    name: "Meta description generator",
    description:
      "Click-worthy, length-perfect SEO meta descriptions (≤155 chars) for a page.",
    promptTemplate:
      "Write 5 SEO meta descriptions for the page below. Each MUST be 140–155 characters, include the primary keyword naturally, and end with a soft call to action.\n\nPage / product: {{page}}\nPrimary keyword: {{primary_keyword}}\nAudience / intent: {{intent}}\n\nReturn a numbered list; after each, show its character count in parentheses." +
      BRAND_RULE,
    inputFields: [
      { name: "page", label: "Page or product", type: "text", required: true, placeholder: "Anniversary flowers collection" },
      { name: "primary_keyword", label: "Primary keyword", type: "text", required: true, placeholder: "anniversary flowers Philippines" },
      { name: "intent", label: "Audience / search intent", type: "text", placeholder: "shoppers looking for same-day anniversary delivery" },
    ],
  },
  {
    teamSlug: "seo",
    name: "SEO title / H1 generator",
    description: "Under-60-character SEO page titles + an H1, keyword-first.",
    promptTemplate:
      "Generate 8 SEO page titles for the page below. Each MUST be under 60 characters, lead with the primary keyword where natural, and be distinct in angle. Then propose one H1 (can exceed 60 chars).\n\nPage / product: {{page}}\nPrimary keyword: {{primary_keyword}}\nSecondary keywords: {{secondary_keywords}}\n\nReturn: a numbered list of titles (each with char count), then a line 'H1: ...'." +
      BRAND_RULE,
    inputFields: [
      { name: "page", label: "Page or product", type: "text", required: true },
      { name: "primary_keyword", label: "Primary keyword", type: "text", required: true },
      { name: "secondary_keywords", label: "Secondary keywords (comma-separated)", type: "text" },
    ],
  },
  {
    teamSlug: "seo",
    name: "Blog title ideas",
    description: "SEO blog post titles grouped by format (listicle, how-to, guide…).",
    promptTemplate:
      "Generate 15 SEO blog post titles about the topic below, grouped under format headings: How-to, Listicle, Guide, Question, Comparison. Each title should target realistic search intent and be under 65 characters.\n\nTopic: {{topic}}\nPrimary keyword: {{primary_keyword}}\nAudience: {{audience}}\n\nIf useful, note next to a title which keyword it targets. Return markdown with the format headings." +
      BRAND_RULE,
    inputFields: [
      { name: "topic", label: "Topic", type: "text", required: true, placeholder: "gift ideas for mom" },
      { name: "primary_keyword", label: "Primary keyword", type: "text" },
      { name: "audience", label: "Audience", type: "text" },
    ],
  },
  {
    teamSlug: "seo",
    name: "Blog post outline",
    description: "A structured H2/H3 outline for a blog post, with intent notes.",
    promptTemplate:
      "Create a detailed blog post outline for the title below. Include: a one-line intro angle, 5–8 H2 sections (each with 2–4 H3 bullet points), a suggested FAQ block (3–5 questions), and a closing CTA idea. Note the primary keyword and 2–3 secondary keywords to weave in.\n\nWorking title: {{title}}\nPrimary keyword: {{primary_keyword}}\nAudience & goal: {{audience_goal}}\n\nReturn markdown with ## and ### headings." +
      BRAND_RULE,
    inputFields: [
      { name: "title", label: "Working title", type: "text", required: true },
      { name: "primary_keyword", label: "Primary keyword", type: "text", required: true },
      { name: "audience_goal", label: "Audience & goal of the post", type: "textarea" },
    ],
  },

  // ---------------- Newsletter / Email ----------------
  {
    teamSlug: "newsletter",
    name: "Email subject line generator",
    description: "High-open-rate subject lines with preview text, varied by angle.",
    promptTemplate:
      "Write 10 email subject lines for the campaign below, grouped by angle: Curiosity, Urgency, Benefit, Personal, Playful. Keep each under 50 characters. For the 3 strongest, add a matching preview-text line (≤90 chars).\n\nCampaign / offer: {{campaign}}\nAudience: {{audience}}\nKey detail to feature: {{key_detail}}\n\nReturn markdown grouped by angle; mark the 3 recommended picks with ⭐." +
      BRAND_RULE,
    inputFields: [
      { name: "campaign", label: "Campaign / offer", type: "text", required: true, placeholder: "Mother's Day early-bird sale" },
      { name: "audience", label: "Audience", type: "text" },
      { name: "key_detail", label: "Key detail to feature", type: "text", placeholder: "20% off, ends Sunday" },
    ],
  },
  {
    teamSlug: "newsletter",
    name: "Welcome email sequence",
    description: "A 4-email welcome/onboarding sequence brief + drafts.",
    promptTemplate:
      "Draft a 4-email welcome sequence for new subscribers. For each email give: send timing, goal, subject line, preview text, and the body (short, scannable, one clear CTA).\nEmail 1: welcome + what to expect. Email 2: brand story / why us. Email 3: bestsellers or social proof. Email 4: first-order incentive (only reference an offer if one is provided).\n\nAudience: {{audience}}\nWhat the brand sells: {{what_we_sell}}\nWelcome offer (optional): {{offer}}\n\nReturn markdown, one section per email." +
      BRAND_RULE,
    inputFields: [
      { name: "audience", label: "Audience / signup source", type: "text", required: true },
      { name: "what_we_sell", label: "What the brand sells", type: "textarea", required: true },
      { name: "offer", label: "Welcome offer (optional)", type: "text" },
    ],
  },
  {
    teamSlug: "newsletter",
    name: "Win-back email",
    description: "A re-engagement email for lapsed customers/subscribers.",
    promptTemplate:
      "Write a win-back email for customers who haven't purchased/opened in a while. Include: subject line, preview text, and a warm, non-pushy body that acknowledges the gap, restates the brand's value, and gives one clear reason to return. Provide 2 subject-line options.\n\nSegment: {{segment}}\nInactivity window: {{window}}\nIncentive (optional): {{incentive}}\n\nReturn markdown." +
      BRAND_RULE,
    inputFields: [
      { name: "segment", label: "Segment", type: "text", required: true, placeholder: "customers with no order in 90 days" },
      { name: "window", label: "Inactivity window", type: "text", placeholder: "90 days" },
      { name: "incentive", label: "Incentive (optional)", type: "text" },
    ],
  },

  // ---------------- Social Media ----------------
  {
    teamSlug: "social-media",
    name: "Instagram caption pack",
    description: "5 on-brand IG captions in different styles, with CTA + hashtags.",
    promptTemplate:
      "Write 5 Instagram captions for the post below, each a different style: Storytelling, Punchy one-liner, Question/engagement, Educational tip, Promotional. Each ≤125 words with 1 clear CTA and 3–5 emojis used tastefully. After the 5 captions, give one block of 12–15 relevant hashtags (mix broad + niche).\n\nPost topic / product: {{topic}}\nOccasion / angle: {{angle}}\nGoal (awareness / engagement / sales): {{goal}}" +
      BRAND_RULE,
    inputFields: [
      { name: "topic", label: "Post topic / product", type: "text", required: true },
      { name: "angle", label: "Occasion / angle", type: "text" },
      { name: "goal", label: "Goal", type: "select", options: ["Awareness", "Engagement", "Sales"] },
    ],
  },
  {
    teamSlug: "social-media",
    name: "Hook generator",
    description: "Scroll-stopping first-line hooks for reels/TikTok/posts.",
    promptTemplate:
      "Generate 15 scroll-stopping hooks (first line / first 2 seconds) for short-form video or a social post about the topic below. Group them by tactic: Curiosity gap, Bold claim, Relatable pain, Question, Number/list, Contrarian. Keep each under 12 words.\n\nTopic / product: {{topic}}\nAudience: {{audience}}\n\nReturn markdown grouped by tactic." +
      BRAND_RULE,
    inputFields: [
      { name: "topic", label: "Topic / product", type: "text", required: true },
      { name: "audience", label: "Audience", type: "text" },
    ],
  },
  {
    teamSlug: "social-media",
    name: "Hashtag set",
    description: "A grouped hashtag set (broad / niche / branded) for a post.",
    promptTemplate:
      "Generate a hashtag set for the post/topic below, grouped into: Broad (high volume), Niche (mid/long-tail), Local/market, and Branded. Aim for ~20 total, all relevant, none banned/spammy. Note the market so local tags fit.\n\nTopic / product: {{topic}}\nMarket / location: {{market}}\n\nReturn markdown grouped by category." +
      BRAND_RULE,
    inputFields: [
      { name: "topic", label: "Topic / product", type: "text", required: true },
      { name: "market", label: "Market / location", type: "text", placeholder: "Philippines" },
    ],
  },
  {
    teamSlug: "social-media",
    name: "LinkedIn post",
    description: "A B2B/brand LinkedIn post that drives engagement.",
    promptTemplate:
      "Write a LinkedIn post about the topic below. Open with a strong hook line, use short 1–2 sentence paragraphs with line breaks for skimmability, deliver one clear insight or story, and end with an engagement question. ~150–200 words. Suggest 3–5 professional hashtags.\n\nTopic / angle: {{topic}}\nWho it's for: {{audience}}\nDesired takeaway: {{takeaway}}" +
      BRAND_RULE,
    inputFields: [
      { name: "topic", label: "Topic / angle", type: "text", required: true },
      { name: "audience", label: "Who it's for", type: "text" },
      { name: "takeaway", label: "Desired takeaway", type: "text" },
    ],
  },

  // ---------------- Meta Ads ----------------
  {
    teamSlug: "meta-ads",
    name: "Primary text variants",
    description: "5 Meta ad primary-text variants across distinct angles.",
    promptTemplate:
      "Write 5 Meta (Facebook/Instagram) ad primary-text variants for the product/offer below, each a different angle: Problem–solution, Social proof, Offer-led, Curiosity, Benefit-stack. Keep each ~50–90 words, front-load the hook (first 125 chars matter), one clear CTA. Note the angle before each.\n\nProduct / offer: {{product}}\nAudience: {{audience}}\nKey benefit / offer: {{benefit}}" +
      BRAND_RULE,
    inputFields: [
      { name: "product", label: "Product / offer", type: "text", required: true },
      { name: "audience", label: "Audience", type: "text" },
      { name: "benefit", label: "Key benefit / offer", type: "text", required: true },
    ],
  },
  {
    teamSlug: "meta-ads",
    name: "Ad headline variants",
    description: "10 short Meta ad headlines (≤40 chars) across angles.",
    promptTemplate:
      "Write 10 Meta ad headlines for the product/offer below. Each MUST be ≤40 characters. Cover a mix of angles: benefit, offer/urgency, curiosity, social proof. Show the character count after each.\n\nProduct / offer: {{product}}\nKey benefit / offer: {{benefit}}\n\nReturn a numbered list." +
      BRAND_RULE,
    inputFields: [
      { name: "product", label: "Product / offer", type: "text", required: true },
      { name: "benefit", label: "Key benefit / offer", type: "text", required: true },
    ],
  },
  {
    teamSlug: "meta-ads",
    name: "Ad angle brainstorm",
    description: "A brief of distinct creative angles to test for a product.",
    promptTemplate:
      "Brainstorm 8 distinct advertising angles to test for the product below. For each: a name, the core message, the target sub-audience/pain it hits, and a one-line creative concept (what the visual/hook would show). Order from most to least promising with a one-line reason for the top pick.\n\nProduct: {{product}}\nAudience(s): {{audiences}}\nWhat makes it different: {{differentiators}}\n\nReturn markdown, one section per angle." +
      BRAND_RULE,
    inputFields: [
      { name: "product", label: "Product", type: "text", required: true },
      { name: "audiences", label: "Audience(s)", type: "textarea" },
      { name: "differentiators", label: "What makes it different", type: "textarea" },
    ],
  },

  // ---------------- Commercial ----------------
  {
    teamSlug: "commercial",
    name: "Product description generator",
    description: "A persuasive, benefit-led product description + short variant.",
    promptTemplate:
      "Write a persuasive product description for the product below. Provide: (1) a long version ~120–160 words with a benefit-led opening, a short features→benefits bullet list, and a closing line; (2) a short version ≤50 words for listings/ads. Focus on benefits and sensory/emotional appeal, not just specs.\n\nProduct: {{product}}\nKey details / specs: {{details}}\nWho it's for / occasion: {{audience}}\n\nReturn markdown with 'Long' and 'Short' headings." +
      BRAND_RULE,
    inputFields: [
      { name: "product", label: "Product name", type: "text", required: true },
      { name: "details", label: "Key details / specs", type: "textarea", required: true },
      { name: "audience", label: "Who it's for / occasion", type: "text" },
    ],
  },
  {
    teamSlug: "commercial",
    name: "Landing page copy",
    description: "Conversion-ready landing-page copy blocks (hero → FAQ → CTA).",
    promptTemplate:
      "Write conversion-ready landing-page copy for the offer below, as labeled blocks: Hero (headline + subhead + CTA button text), 3 benefit blocks (heading + 1–2 sentences each), a social-proof line, a short FAQ (3–4 Q&A), and a closing CTA. Keep it skimmable and benefit-led.\n\nProduct / offer: {{product}}\nPrimary goal / conversion action: {{goal}}\nAudience: {{audience}}\nKey benefits: {{benefits}}\n\nReturn markdown with a heading per block." +
      BRAND_RULE,
    inputFields: [
      { name: "product", label: "Product / offer", type: "text", required: true },
      { name: "goal", label: "Primary conversion action", type: "text", placeholder: "Buy now / Book a call" },
      { name: "audience", label: "Audience", type: "text" },
      { name: "benefits", label: "Key benefits", type: "textarea", required: true },
    ],
  },
];

async function main() {
  const allTeams = await db.query.teams.findMany();
  const teamBySlug = new Map(allTeams.map((t) => [t.slug, t]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of TEMPLATES) {
    const team = teamBySlug.get(t.teamSlug);
    if (!team) {
      console.warn(`  ! team "${t.teamSlug}" not found — skipping "${t.name}"`);
      skipped++;
      continue;
    }

    const existing = await db.query.taskTemplates.findFirst({
      where: and(
        eq(taskTemplates.teamId, team.id),
        eq(taskTemplates.name, t.name),
      ),
    });

    const values = {
      teamId: team.id,
      name: t.name,
      description: t.description,
      promptTemplate: t.promptTemplate,
      inputFields: t.inputFields,
      model: MODEL,
      renderAs: "markdown",
      isActive: true,
    };

    if (existing) {
      await db
        .update(taskTemplates)
        .set(values)
        .where(eq(taskTemplates.id, existing.id));
      updated++;
      console.log(`  ~ updated  [${t.teamSlug}] ${t.name}`);
    } else {
      await db.insert(taskTemplates).values(values);
      created++;
      console.log(`  + created  [${t.teamSlug}] ${t.name}`);
    }
  }

  console.log(
    `\nDone. ${created} created, ${updated} updated, ${skipped} skipped (of ${TEMPLATES.length}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
