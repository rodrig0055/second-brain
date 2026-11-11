/**
 * Seeds the AI search tracker for Acme Florals: who "we" are, and a
 * starting set of 41 Philippine buyer prompts tagged by journey stage and
 * topic. Edit them in the Brain (SEO > AI prompts) after; this only adds.
 *
 *   set -a && . ./.env.local && set +a && npx tsx scripts/seed-ai-search.ts [--dry]
 *
 * Idempotent: settings are created only if missing (never overwritten, the
 * team edits them), and prompts are unique per brand by text.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const dry = process.argv.includes("--dry");

const BRAND_SLUG = "acme-florals";
// Never a generic phrase like "flower shop": every answer about flowers says it.
const ALIASES = ["acme florals", "acmeflorals", "acmeflorals.example"];
const DOMAINS = ["acmeflorals.example"];

type S = "awareness" | "consideration" | "decision";
const PROMPTS: [string, S, string][] = [
  // Same-day delivery
  ["Where can I order same-day flower delivery in Metro Manila?", "decision", "same-day delivery"],
  ["Best online flower shop in the Philippines with same-day delivery", "decision", "same-day delivery"],
  ["Can I get flowers delivered today in Quezon City?", "decision", "same-day delivery"],
  ["Last-minute flower delivery in Makati, what are my options?", "decision", "same-day delivery"],
  ["Same-day flower delivery in Cebu City", "decision", "same-day delivery"],
  ["Flower delivery in Davao City that delivers today", "decision", "same-day delivery"],
  // Sending from abroad
  ["How can I send flowers to my mom in the Philippines from the US?", "decision", "send from abroad"],
  ["Best way for an OFW to send flowers and gifts to family in the Philippines", "consideration", "send from abroad"],
  ["Reliable flower delivery to the Philippines from Dubai", "decision", "send from abroad"],
  ["Send flowers to Manila from Canada", "decision", "send from abroad"],
  // Occasions
  ["Best birthday flower delivery in Manila", "decision", "birthday"],
  ["What flowers should I give my girlfriend for her birthday in the Philippines?", "awareness", "birthday"],
  ["Anniversary flowers and gift delivery in Metro Manila", "decision", "anniversary"],
  ["Where to order Valentine's Day flowers in the Philippines before they sell out", "decision", "valentine's"],
  ["How much does a dozen roses cost in Manila on Valentine's Day?", "consideration", "valentine's"],
  ["Mother's Day flower delivery Philippines", "decision", "mother's day"],
  ["Where to order funeral flowers or a sympathy wreath delivered in Manila", "decision", "sympathy"],
  ["What flowers are appropriate to send to a wake in the Philippines?", "awareness", "sympathy"],
  ["Get well soon flowers delivered to a hospital in Manila", "decision", "get well"],
  ["Christmas flowers and gift delivery in the Philippines", "decision", "christmas"],
  ["Graduation bouquet delivery in Manila", "decision", "graduation"],
  // Flowers plus gifts
  ["Flowers with cake delivery in Metro Manila", "decision", "flowers + gifts"],
  ["Flowers and chocolates delivery Philippines", "decision", "flowers + gifts"],
  ["Balloon and flower bouquet delivery in Manila", "decision", "flowers + gifts"],
  ["Gift delivery in the Philippines for someone who doesn't like flowers", "awareness", "flowers + gifts"],
  // Price
  ["Cheap but nice flower delivery in Manila", "consideration", "price"],
  ["How much does flower delivery cost in the Philippines?", "consideration", "price"],
  ["Affordable bouquet under 2,000 pesos delivered in Quezon City", "decision", "price"],
  // Comparison and brand
  ["What is the most reliable online florist in the Philippines?", "consideration", "comparison"],
  ["Best flower delivery services in the Philippines compared", "consideration", "comparison"],
  ["Which flower shop in Manila has the freshest flowers and on-time delivery?", "consideration", "comparison"],
  ["Is it better to buy flowers from an online florist or from Lazada or Shopee in the Philippines?", "consideration", "comparison"],
  ["Is Acme Florals legit?", "decision", "brand"],
  ["Acme Florals reviews", "consideration", "brand"],
  // Flower advice
  ["What are the best flowers to give in the Philippines for different occasions?", "awareness", "flower advice"],
  ["How do I keep a bouquet fresh longer in hot Philippine weather?", "awareness", "flower advice"],
  ["Preserved flowers or fresh flowers: which is the better gift?", "awareness", "flower advice"],
  // Outside Metro Manila
  ["Flower delivery to provinces in the Philippines outside Metro Manila", "decision", "provincial delivery"],
  ["Flower delivery in Baguio", "decision", "provincial delivery"],
  ["Flower delivery in Iloilo City", "decision", "provincial delivery"],
  // Corporate
  ["Corporate flower arrangements and office flower delivery in Makati", "decision", "corporate"],
];

async function main() {
  const [brand] = await sql`SELECT id, name FROM brands WHERE slug = ${BRAND_SLUG}`;
  if (!brand) throw new Error(`brand ${BRAND_SLUG} not found`);
  console.log(`${brand.name}: ${PROMPTS.length} prompts${dry ? " (dry run)" : ""}`);
  if (dry) {
    for (const [t, s, topic] of PROMPTS) console.log(`  [${s}] ${topic}: ${t}`);
    return;
  }
  await sql`
    INSERT INTO ai_search_settings (brand_id, aliases, domains)
    VALUES (${brand.id}, ${JSON.stringify(ALIASES)}::jsonb, ${JSON.stringify(DOMAINS)}::jsonb)
    ON CONFLICT (brand_id) DO NOTHING`;
  let added = 0;
  for (const [text, stage, topic] of PROMPTS) {
    const r = await sql`
      INSERT INTO ai_search_prompts (brand_id, text, stage, topic)
      VALUES (${brand.id}, ${text}, ${stage}, ${topic})
      ON CONFLICT (brand_id, text) DO NOTHING
      RETURNING id`;
    added += r.length;
  }
  console.log(`settings ok, ${added} prompts added (${PROMPTS.length - added} already there)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
