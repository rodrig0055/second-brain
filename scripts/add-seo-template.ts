import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { taskTemplates, teams } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const NAME = "SEO category page copy";

const PROMPT = `Write SEO copy for an e-commerce category/collection page, ~500 words (stay within 450–560), as clean semantic HTML.

Page URL: {{category_url}}
Primary keyword (must appear in the H1): {{primary_keyword}}
Secondary keywords (use in H2s where natural): {{secondary_keywords}}
What's on the page (product types / sub-categories): {{page_notes}}
Internal links to weave in (use these real URLs verbatim — same brand domain only): {{internal_links}}

Use the active brand's voice, market, and USPs from the brand context above. This skill is for the flower & gifting brands only (Acme Florals, Bloomly PH, Bloomly SG, Bloomly VN, Bloomly TH). If the selected brand is Northwind Audio, stop and say this template doesn't cover it.

Structure (HTML):
<h1>[primary keyword] — [value proposition]</h1>
<p>Intro: hook + brand relevance (2–3 sentences)</p>
<h2>[secondary keyword / intent heading]</h2>
<p>Buying guide: what makes a good choice in this category, how to choose</p>
<h2>[Gift Ideas / Buying Guide heading]</h2>
<ul>3–5 bullets with bold sub-type labels</ul>
<p>Closing sentence</p>
<h2>Explore More Collections</h2>
<ul>4–6 internal links from the list above</ul>
<h2>Why Shop With Us?</h2>
<p>USP paragraph (mandatory, last): free same-day delivery, extensive assortment, perfect for any occasion — adapted to this brand and market.</p>

Rules: no specific product names (keep it evergreen); never invent delivery times/prices/coverage — if the brand context doesn't state them, keep USP wording general; never link to a different brand or market. Output only the HTML unless the user asked for plain text or markdown.`;

const inputFields = [
  { name: "primary_keyword", label: "Primary keyword (goes in H1)", type: "text" as const, required: true, placeholder: "anniversary gifts Philippines" },
  { name: "secondary_keywords", label: "Secondary keywords (comma-separated)", type: "text" as const, placeholder: "anniversary flowers, romantic gifts" },
  { name: "category_url", label: "Category / collection URL", type: "text" as const, required: true, placeholder: "https://acmeflorals.example/collections/anniversary" },
  { name: "page_notes", label: "What's on the page (product types, sub-categories)", type: "textarea" as const, placeholder: "rose bouquets, gift baskets, cakes add-ons…" },
  { name: "internal_links", label: "Internal links to include (real URLs, same domain)", type: "textarea" as const, placeholder: "https://acmeflorals.example/collections/birthday\nhttps://acmeflorals.example/collections/for-her" },
];

async function main() {
  const seo = await db.query.teams.findFirst({ where: eq(teams.slug, "seo") });
  if (!seo) throw new Error("SEO team not found — run db:seed first.");

  const existing = await db.query.taskTemplates.findFirst({
    where: and(eq(taskTemplates.teamId, seo.id), eq(taskTemplates.name, NAME)),
  });

  const values = {
    teamId: seo.id,
    name: NAME,
    description:
      "~500-word SEO copy for a flower/gifting category page. Pick the brand at run time; paste the page's product types and internal links.",
    promptTemplate: PROMPT,
    inputFields,
    model: "google/gemini-3.5-flash-lite",
    isActive: true,
  };

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
