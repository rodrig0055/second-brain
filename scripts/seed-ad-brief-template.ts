/**
 * Seeds the "Ad brief" task template for the Meta Ads team.
 *
 *   npx tsx scripts/seed-ad-brief-template.ts [--team meta-ads] [--dry]
 *
 * The brief is a task template rather than a hardcoded form so that the
 * questions it asks, the copy rules it follows and the model it uses are all
 * editable in Admin → Templates by the people who write ads, without a deploy.
 * What the code supplies is the part a prompt cannot: the account's own last 30
 * days, and the guard that an ad set id must be one that exists.
 *
 * Idempotent. Re-running updates the prompt and fields in place, and never
 * changes the model once someone has picked a different one, because that is a
 * cost decision somebody made deliberately.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const NAME = "Ad brief";

/**
 * The model the brief runs on by default.
 *
 * Picked because it is the one verified end to end against this deployment's
 * keys: Anthropic is out of credit on this account and the Google key is not
 * set locally. Whoever runs the brief can pick another in the model dropdown.
 */
const DEFAULT_MODEL = "openai/gpt-6.1-sol";

const DESCRIPTION =
  "Say what the ad is for. Get drafts back written from what has actually sold " +
  "in the account, ready to edit and send to the pipeline.";

/** Sales the team runs. The lint checks copy against whichever is chosen. */
const PURPOSES = [
  "BAU",
  "PAYDAY",
  "9.9",
  "10.10",
  "11.11",
  "12.12",
  "GRANDPARENTS",
  "BDAY",
  "QIXI",
];

const INPUT_FIELDS = [
  {
    name: "goal",
    label: "What are we trying to achieve?",
    type: "textarea" as const,
    required: true,
    placeholder:
      "e.g. Push the 9.9 sale to people who already know us. Bundles from P999, free same-day delivery.",
  },
  {
    name: "purpose",
    label: "Sale or occasion",
    type: "select" as const,
    options: PURPOSES,
    required: true,
  },
  {
    name: "eventDate",
    label: "When it lands",
    type: "date" as const,
    placeholder: "Pick a date",
  },
  {
    name: "funnel",
    label: "Funnel",
    type: "select" as const,
    options: ["Let the brain choose", "TOF", "MOF", "BOF"],
  },
  {
    name: "linkUrl",
    label: "Where the ad sends people",
    type: "text" as const,
    placeholder: "https://…",
  },
  {
    name: "notes",
    label: "Anything that must be said (prices, mechanics, what to avoid)",
    type: "textarea" as const,
    placeholder: "e.g. must say free same-day delivery; do not promise stock on the day itself",
  },
];

/**
 * The prompt.
 *
 * Deliberately about judgement and voice only. The numbers are appended by
 * src/lib/ads/drafts/propose.ts from stored insights, so this text never has to
 * be rewritten when the account's performance changes, and cannot go stale
 * against it.
 */
const PROMPT = `You are writing Meta ad drafts for this brand's performance marketing team.

# The request
Goal: {{goal}}
Sale or occasion: {{purpose}}
Date it lands: {{eventDate}}
Funnel asked for: {{funnel}}
Landing page: {{linkUrl}}
Must say / must avoid: {{notes}}

# What you are producing
Two or three genuinely different options, not rewordings of one idea. Each is a
draft an ad buyer will edit and upload, so every field has to be usable as
written.

# How to choose
- Read the account context below before writing anything. Lead with what has
  already sold: reuse the angles and hooks of the ads listed as working, and
  stay away from the ones listed as not working.
- If the request names a funnel, use it. If it says "Let the brain choose",
  pick from the goal: cold prospecting is TOF, people who already engaged are
  MOF, cart abandoners and past customers are BOF.
- Pick the target ad set from the list in the context, matching the funnel.
  Copy its id exactly. If none fits, leave the id empty and say so in the note.
- Match the account's reality. If a funnel is already over its CIR target, do
  not write copy that leans harder on the same thing that is missing.

# How to write it
- Taglish the way this brand already writes it, taken from the winning captions
  in the context, not from a general idea of Taglish.
- Headline: 25 to 40 characters. Over 60 and Meta cuts it off mid-word.
- Primary text: the offer, the price and the date must all appear in the first
  125 characters, because that is where "See more" folds the rest away.
- Name only the sale you were given. A caption for a 9.9 sale must not mention
  8.8, and must not carry a date from a previous sale. This has gone live
  before and it is the single most common defect in the queue.
- Never invent a price, a discount, a product or a delivery promise that is not
  in the request, the notes or the brand knowledge above.

# Rationale
For each option, name the ad or the number in the context it leans on, so the
buyer can check it against the table. If there is nothing to lean on, say that
plainly instead of inventing a justification.`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const teamSlug = arg("team") ?? "meta-ads";

  const { db } = await import("../src/db");
  const { teams, taskTemplates } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, teamSlug),
  });
  if (!team) throw new Error(`No team with slug "${teamSlug}".`);

  const existing = await db.query.taskTemplates.findFirst({
    where: and(eq(taskTemplates.teamId, team.id), eq(taskTemplates.name, NAME)),
  });

  console.log(
    `${dry ? "[dry] " : ""}${existing ? "Updating" : "Creating"} "${NAME}" for ${team.name}`,
  );
  console.log(`  fields: ${INPUT_FIELDS.map((f) => f.name).join(", ")}`);
  console.log(`  renderAs: ad-brief`);
  const model = arg("model") ?? existing?.model ?? DEFAULT_MODEL;
  console.log(`  model: ${model}`);
  if (dry) return;

  if (existing) {
    await db
      .update(taskTemplates)
      .set({
        description: DESCRIPTION,
        promptTemplate: PROMPT,
        inputFields: INPUT_FIELDS,
        renderAs: "ad-brief",
        isActive: true,
        // Only when asked for: the model is a cost decision, and re-running the
        // seed must not quietly put an expensive one back.
        ...(arg("model") ? { model } : {}),
      })
      .where(eq(taskTemplates.id, existing.id));
  } else {
    await db.insert(taskTemplates).values({
      teamId: team.id,
      name: NAME,
      description: DESCRIPTION,
      promptTemplate: PROMPT,
      inputFields: INPUT_FIELDS,
      model,
      renderAs: "ad-brief",
      isActive: true,
    });
  }

  console.log(`\nDone. It appears under /t/${team.slug}/tasks.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
