import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull, and } from "drizzle-orm";
import * as schema from "./schema";
import {
  brands,
  departments,
  knowledgeDocs,
  taskTemplates,
  teams,
  users,
} from "./schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

const MASTER_PROMPT = `# Second Brain: Master Prompt

You are the AI operating assistant for a multi-brand ecommerce group. The active brand,
its voice, offer rules and catalog are given in the brand context below.

## Truth over approval
Accuracy beats pleasing the user. If a premise is weak, false, or over-optimistic, say so early and explain.
Never invent numbers, dates, prices, product claims, policies, or facts.
State confidence as high / medium / low / unknown when uncertain.

## Brand voice is law
The brand context below (voice, offer rules, catalog notes, proven winners) is the source of truth.
Always write in the active brand's voice. If the brand context does not cover something you need
(a price, a policy, a product claim), say "not covered in brand context" instead of inventing it.

## Offer discipline
Respect the brand's offer rules on every discount or promotion you draft. If a requested offer
conflicts with the rules, flag the conflict instead of complying silently.

## Output style
Direct, factual, concise. Lead with the strategic call, then the deliverable, then assumptions
and open questions. Concrete dates over relative ones. No filler.`;

const DEMO_DOCS = [
  {
    kind: "brand-voice" as const,
    title: "Acme Florals: brand voice",
    content: `Warm, plain-spoken and a little playful. Short sentences. We sound like a friend
who happens to know flowers, never like a luxury catalogue.
Do: name the occasion, name the feeling, give one concrete detail about the bouquet.
Don't: superlatives without proof ("the best"), exclamation marks in every line, emojis in email subject lines.`,
  },
  {
    kind: "offer-rules" as const,
    title: "Acme Florals: offer rules",
    content: `- Maximum discount: 20%, capped at $15 per order.
- Never discount same-day delivery fees.
- No discounts in the 7 days before Valentine's Day or Mother's Day.
- Free delivery is always on orders over $60; say it, it is our strongest hook.`,
  },
  {
    kind: "catalog" as const,
    title: "Acme Florals: catalog notes",
    content: `Hero lines: hand-tied bouquets ($45-$120), flower boxes ($55-$150), preserved roses ($70+).
Add-ons: chocolates, balloons, greeting card (free).
Delivery: same-day if ordered before 2pm local time.`,
  },
];

async function main() {
  // Departments
  const departmentRows = [
    { slug: "marketing", name: "Marketing" },
    { slug: "commercial", name: "Commercial" },
  ];
  await db.insert(departments).values(departmentRows).onConflictDoNothing();
  const allDepartments = await db.query.departments.findMany();
  const deptId = (slug: string) =>
    allDepartments.find((d) => d.slug === slug)!.id;

  // Teams
  const teamRows = [
    { slug: "seo", name: "SEO", departmentId: deptId("marketing") },
    { slug: "social-media", name: "Social Media", departmentId: deptId("marketing") },
    { slug: "meta-ads", name: "Meta Ads", departmentId: deptId("marketing") },
    { slug: "newsletter", name: "Newsletter", departmentId: deptId("marketing") },
    { slug: "google-ads", name: "Google Ads", departmentId: deptId("marketing") },
    { slug: "partnerships", name: "Partnerships", departmentId: deptId("commercial") },
    { slug: "commercial", name: "Commercial", departmentId: deptId("commercial") },
  ];
  await db.insert(teams).values(teamRows).onConflictDoNothing();

  // Brands
  const brandRows = [
    // Fictional demo brands. Replace with your own; the domain drives sitemap,
    // feed and Search Console lookups.
    { slug: "acme-florals", name: "Acme Florals", domain: "acmeflorals.example" },
    { slug: "bloomly-ph", name: "Bloomly PH", domain: "bloomly-ph.example" },
    { slug: "northwind-audio", name: "Northwind Audio", domain: "northwindaudio.example" },
    { slug: "bloomly-sg", name: "Bloomly SG", domain: "bloomly-sg.example" },
    { slug: "bloomly-vn", name: "Bloomly VN", domain: "bloomly-vn.example" },
    { slug: "bloomly-th", name: "Bloomly TH", domain: "bloomly-th.example" },
  ];
  await db.insert(brands).values(brandRows).onConflictDoNothing();

  // First admin
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  await db
    .insert(users)
    .values({ email: adminEmail.toLowerCase(), role: "admin", name: "Admin" })
    .onConflictDoNothing();

  // Global master prompt (only if no active one exists yet)
  const existingMaster = await db.query.knowledgeDocs.findFirst({
    where: and(
      eq(knowledgeDocs.kind, "master-prompt"),
      isNull(knowledgeDocs.brandId),
    ),
  });
  if (!existingMaster) {
    await db.insert(knowledgeDocs).values({
      kind: "master-prompt",
      title: "Master Prompt",
      content: MASTER_PROMPT,
    });
  }

  // Demo brand knowledge, so the prompt assembly has something to assemble.
  const acme = await db.query.brands.findFirst({ where: eq(brands.slug, "acme-florals") });
  if (acme) {
    const have = await db.query.knowledgeDocs.findFirst({ where: eq(knowledgeDocs.brandId, acme.id) });
    if (!have) {
      await db.insert(knowledgeDocs).values(
        DEMO_DOCS.map((d) => ({ ...d, brandId: acme.id })),
      );
    }
  }

  // Starter task templates (one per team), skipped if the team already has any
  const allTeams = await db.query.teams.findMany();
  const teamId = (slug: string) => allTeams.find((t) => t.slug === slug)!.id;

  const starterTemplates = [
    {
      teamId: teamId("seo"),
      name: "SEO content brief",
      description: "Full brief for a writer: structure, entities, FAQs, internal links.",
      promptTemplate: `Create an SEO content brief for the target keyword "{{keyword}}".
Search intent / audience: {{intent}}
Extra notes: {{notes}}

Include: recommended title + H1, meta description, outline with H2/H3s, entities and subtopics to cover, FAQs to answer, suggested internal link anchors, and a target word count with reasoning.`,
      inputFields: [
        { name: "keyword", label: "Target keyword", type: "text" as const, required: true },
        { name: "intent", label: "Search intent / audience", type: "text" as const, required: true },
        { name: "notes", label: "Extra notes", type: "textarea" as const },
      ],
    },
    {
      teamId: teamId("social-media"),
      name: "Social captions pack",
      description: "5 caption options for one post, platform-tuned.",
      promptTemplate: `Write 5 caption options for a {{platform}} post.
Topic / product: {{topic}}
Occasion or angle: {{angle}}

Vary the hooks (question, bold claim, social proof, urgency, storytelling). Include hashtag suggestions where the platform calls for them. Respect the brand voice strictly.`,
      inputFields: [
        { name: "platform", label: "Platform", type: "select" as const, options: ["Instagram", "Facebook", "TikTok"], required: true },
        { name: "topic", label: "Topic / product", type: "text" as const, required: true },
        { name: "angle", label: "Occasion or angle", type: "text" as const },
      ],
    },
    {
      teamId: teamId("meta-ads"),
      name: "Meta ad copy variants",
      description: "3 primary texts + headlines + descriptions for one ad concept.",
      promptTemplate: `Draft Meta ad copy for: {{product}}
Offer: {{offer}}
Audience / angle: {{angle}}

Produce 3 variants. Each variant: primary text (under 125 chars before the fold), headline (under 40 chars), description (under 30 chars). Then recommend which variant to test first and why. Respect offer rules — flag any conflict.`,
      inputFields: [
        { name: "product", label: "Product / collection", type: "text" as const, required: true },
        { name: "offer", label: "Offer", type: "text" as const, required: true },
        { name: "angle", label: "Audience / angle", type: "textarea" as const },
      ],
    },
    {
      teamId: teamId("newsletter"),
      name: "Newsletter draft",
      description: "Subject lines + full email body for one campaign.",
      promptTemplate: `Draft an email newsletter.
Theme / occasion: {{theme}}
Featured products: {{products}}
Offer (if any): {{offer}}

Deliver: 5 subject line options (with preview text), then the full email body (hook, product sections, single clear CTA), then a plain-text SMS companion under 160 characters. Respect offer rules.`,
      inputFields: [
        { name: "theme", label: "Theme / occasion", type: "text" as const, required: true },
        { name: "products", label: "Featured products", type: "textarea" as const, required: true },
        { name: "offer", label: "Offer", type: "text" as const },
      ],
    },
    {
      teamId: teamId("commercial"),
      name: "Product listing copy",
      description: "Title, description, and selling points for a new product listing.",
      promptTemplate: `Write product listing copy for: {{product}}
Key details (materials, size, price point, supplier notes): {{details}}

Deliver: product title, 150-200 word description in brand voice, 5 bullet selling points, and 3 cross-sell suggestions. Never invent specs that are not in the details provided — list missing info as open questions instead.`,
      inputFields: [
        { name: "product", label: "Product name", type: "text" as const, required: true },
        { name: "details", label: "Key details", type: "textarea" as const, required: true },
      ],
    },
  ];

  for (const tpl of starterTemplates) {
    const existing = await db.query.taskTemplates.findFirst({
      where: eq(taskTemplates.teamId, tpl.teamId),
    });
    if (!existing) {
      await db.insert(taskTemplates).values({ ...tpl, model: DEFAULT_MODEL });
    }
  }

  console.log("Seed complete:");
  console.log(`- ${teamRows.length} teams, ${brandRows.length} brands`);
  console.log(`- admin: ${adminEmail}`);
  console.log("- global master prompt, demo brand docs, 1 starter template per team");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
