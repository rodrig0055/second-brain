import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { isNull } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { imageTemplates } from "../src/db/schema";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Image prompts from the "Make Everything" GPT Image campaign prompt pack (Matthew Berman,
// https://drop.emerald.digital/make-everything/make-everything-prompt-pack.pdf).
//
// Adapted for Image Studio in three ways:
// - Ratio wording ([RATIO], "square", "16:9") is stripped from the prompt text. The studio's
//   Formats picker sends the aspect ratio to the model on its own, so a ratio baked into the
//   brief would contradict whichever format the user picks. The pack's format is in the description.
// - No reference images. Each prompt says "the attached product"; the user attaches their own
//   photo per generation. Template references are auto-attached to every run, so the pack's
//   example images must not be stored here.
// - The E1 event brief ("paste it above every prompt in this section") is baked into each event
//   template. E2 and the planning half of E5 are text-chat prompts, not image prompts, so they
//   are not included.
//
// Idempotent: skips any all-brands template whose name already exists.

const EVENT_BRIEF = `EVENT NAME: [EXACT NAME / NAMES BEING CONSIDERED]
WHAT PEOPLE ARE COMING FOR: [EXPERIENCE]
AUDIENCE: [WHO SHOULD WANT A TICKET]
CITY / VENUE: [EXACT DETAILS]
DATE / TIME: [EXACT DETAILS]
HOST / ARTIST: [NAME]
SPONSOR: [NAME, OR OMIT]
FEELING: [WHAT THE NIGHT SHOULD FEEL LIKE]
REQUIRED COPY: [EXACT WORDS]
DO NOT USE THESE WORDS: [WORDS / OLD NAMES / OLD DATES]

Attached references:
[FILE 1] is for [VISUAL STYLE / NAME / LAYOUT / ACTUAL LOGO].
[FILE 2] is for [VISUAL STYLE / NAME / LAYOUT / ACTUAL LOGO].
An image marked VISUAL STYLE does not approve the name printed on it.
Omit missing event details instead of making them up.`;

// The pack runs each thumbnail treatment as its own generation, so each is its own template.
const thumbnail = (treatment: string) => `Create one YouTube thumbnail for this video:
"[VIDEO TITLE]".

Use the person in the attached photo. Keep their identity recognizable.
The main reason to click is [SURPRISE / RESULT / QUESTION].
Use this treatment: ${treatment}
The only thumbnail text is "[EXACT TWO-TO-FOUR-WORD HEADLINE]".
Make the face, key object, and headline readable at small size.

Avoid: extra words, invented logos, unrelated props, generic UI clutter, changing the person's identity, or covering their eyes with text.`;

const TEMPLATES: { name: string; description: string; prompt: string }[] = [
  {
    name: "Ad: Comparison",
    description:
      "Attach your product photo and logo. Write the comparison copy yourself and keep it accurate. Format: Instagram post (1:1).",
    prompt: `Create one comparison ad for [PRODUCT / OFFER].

Split the canvas into two equal vertical halves.
LEFT: [YOUR PRODUCT], shown [VISUAL THAT DEMONSTRATES THE BENEFIT].
RIGHT: [ALTERNATIVE], shown [VISUAL THAT DEMONSTRATES THE FRUSTRATION].

Make the contrast understandable before anyone reads the words.
Use these exact headings:
Left: "[LEFT HEADING]"
Right: "[RIGHT HEADING]"

Use these exact bullets, kept on their assigned side:
Left: [FOUR SHORT BULLETS]
Right: [FOUR SHORT BULLETS]

Use the attached product and logo faithfully. Style: [STYLE].
Colors: [COLORS]. Make the copy readable on a phone.

Avoid: extra claims, invented statistics, extra logos, tiny text, copy crossing the center line, or changes to the product.`,
  },
  {
    name: "Ad: Kitchen whiteboard",
    description:
      "Attach your product photo. Pick a before/after idea simple enough to draw with a marker.",
    prompt: `Create a casual phone photograph of a small kitchen whiteboard.
A hand holds the exact attached product naturally in the foreground.
The board is the main thing we need to read.

On the whiteboard, draw two simple marker illustrations:
"Before": [A VISUAL MESS / PROBLEM]
"After": [THE SAME ELEMENTS ARRANGED TO SHOW THE SOLUTION]
Connect them with one hand-drawn arrow.

Underneath, write exactly: "[ONE SHORT LINE CONNECTING THE DRAWING TO THE PRODUCT]".

Real marker strokes, ordinary kitchen light, natural phone-camera detail.
The drawing should explain the idea, not decorate the board.

Avoid: glossy studio styling, printed-looking marker text, extra copy, illegible scribbles, altered product packaging, exaggerated blur.`,
  },
  {
    name: "Ad: Product surrounded by proof",
    description:
      "Attach product photo and logo. Supply the exact benefits or numbers to show, real ones only. Format: Instagram post (1:1).",
    prompt: `Create one ad with the attached product large in the center.
Arrange these four short callouts around it with generous spacing:
[CALLOUT 1]
[CALLOUT 2]
[CALLOUT 3]
[CALLOUT 4]

Connect each callout to the product with a clean line or small arrow.
Headline at the top: "[EXACT HEADLINE]".
Brand colors: [COLORS]. Keep the product recognizable and the callouts readable on a phone. Give each callout its own clear area.

Avoid: invented numbers, extra benefits, crossed connector lines, text covering the product, tiny footnotes, or altered packaging.`,
  },
  {
    name: "Campaign: Matching ad",
    description:
      "Attach product photos, your logo, and an approved ad if you have one. For the next ad in the set, attach the product photo plus the ad to match.",
    prompt: `Create one campaign ad for [PRODUCT].

PRODUCT:
Reproduce the attached product faithfully. Preserve its shape, color, material, printed graphics, logo, proportions, and visible details.
Use the photo as the source of truth. Do not relocate or redesign details.

CAMPAIGN IDEA: [ONE SENTENCE ABOUT WHY SOMEONE WOULD WANT THIS].
AUDIENCE: [WHO IS BUYING].
SETTING: [A SPECIFIC PLACE THAT SUPPORTS THE IDEA].
LIGHT: [LIGHT THAT BELONGS IN THAT PLACE].
STYLE: [PHOTOGRAPHIC AND TYPOGRAPHIC DIRECTION].

Headline, verbatim: "[HEADLINE]".
Brand mark: use the attached logo at [POSITION].
[Optional] CTA, verbatim: "[CTA]".

Make the product the hero. Make the words and image sell the same idea.

Avoid: invented branding, additional claims, changes to the product, extra slogans, decorative clutter, or styles unrelated to the brief.`,
  },
  {
    name: "Product photo: Catalog shot",
    description:
      "Attach the actual side of the product you want shown. It invents sides it has not seen, so upload a back photo for a back shot. Delete the apparel line if not apparel.",
    prompt: `Create one ecommerce product photograph showing [VIEW] of the exact product in the attached reference photos.

[For apparel] A [MODEL DESCRIPTION] wears it naturally, [POSE].
The fit should match [FIT REFERENCE / DESCRIPTION].

Background: [BACKGROUND]. Lighting: soft, even commercial lighting.
Frame the entire product clearly. Preserve its real color, construction, texture, graphics, and branding. Use the matching reference for this view.

Avoid: invented unseen details, duplicated front graphics on the back, extra accessories, obscured product features, changed logos, or a different fit.`,
  },
  {
    name: "UGC: Casual phone photo",
    description:
      "Attach product photos, plus a person reference if the same person must appear again. In mirror shots, check that product lettering reads backwards.",
    prompt: `Create one casual phone photo of [PERSON DESCRIPTION] using or wearing the exact attached product in [ORDINARY LOCATION].
Action: [A SIMPLE BELIEVABLE ACTION].

Use natural light from that location, ordinary phone-camera focus, slightly imperfect framing, real skin texture, and believable fabric.
Keep the product recognizable and accurate.

[Optional] Add this exact caption in simple readable white type: "[CAPTION]". Keep it clear of the product and face.

Avoid: beauty-filter skin, excessive sharpening, dramatic studio light, artificial portrait blur, extra fingers, warped objects, added logos, or made-up customer results.`,
  },
  {
    name: "Thumbnail: Loud result",
    description:
      "Big reaction, one oversized object, strong contrast. Attach a clear presenter photo. Format: Landscape / YouTube (16:9).",
    prompt: thumbnail(
      "Loud result. An expressive reaction, one oversized relevant object, strong color contrast, one arrow only if it points at something that matters.",
    ),
  },
  {
    name: "Thumbnail: Quiet curiosity",
    description:
      "Restrained expression, one intriguing object, simple background. Attach a clear presenter photo. Format: Landscape / YouTube (16:9).",
    prompt: thumbnail(
      "Quiet curiosity. A restrained expression, one intriguing object or situation, simple background, space around the headline.",
    ),
  },
  {
    name: "Thumbnail: Product first",
    description:
      "Product large and central, presenter small in a corner. Attach a presenter photo and the product. Format: Landscape / YouTube (16:9).",
    prompt: thumbnail(
      "Product first. The product large and central, the presenter's face smaller in a corner, clean setting, lighting that reveals the product.",
    ),
  },
  {
    name: "Explainer: Three steps",
    description:
      "Attach your logo. Write the three steps first. Making a chart instead? Supply the data and check every label.",
    prompt: `Create one product explainer for [PRODUCT].
Headline: "[EXACT HEADLINE]".

Three numbered panels, read from left to right:
01 / [LABEL]: "[ONE SHORT SENTENCE]"
02 / [LABEL]: "[ONE SHORT SENTENCE]"
03 / [LABEL]: "[ONE SHORT SENTENCE]"

Use one clear illustration per panel and arrows from 01 to 02 to 03.
Brand colors: [HEX VALUES]. Background: [COLOR].
Typography and visual style: [DIRECTION].
Use the attached logo at [POSITION]. URL, verbatim: "[URL]".
Make the explanation readable on a phone.

Avoid: extra steps, reversed arrows, invented metrics, altered wording, extra icons, tiny labels, or a redrawn brand name.`,
  },
  {
    name: "Consistency: Same character, new camera",
    description:
      'Attach your approved character or person reference. Describe the camera literally, e.g. "The camera sees the back of the head. The face is hidden."',
    prompt: `Show the exact same [PERSON / CHARACTER] from the attached reference, [CAMERA POSITION], doing [ACTION] in [SETTING].

Camera direction: [DESCRIBE WHAT THE CAMERA SEES].
Keep the same face, proportions, clothing, colors, and identifying details.
Style: [MATCH THE REFERENCE / SPECIFY STYLE].

Avoid: turning the subject back toward the camera to show their face, adding facial features to the back of the head, changing costume or identity, or substituting a more familiar pose.`,
  },
  {
    name: "Edit: Change one thing",
    description:
      "Attach the approved image and pick the same format it was made in. Save a copy before every change.",
    prompt: `Edit the attached image.
Change ONLY [THE EXACT ELEMENT] from "[CURRENT]" to "[NEW]".

Preserve the composition, product, person, background, logo, all other text, colors, spacing, and image dimensions. Do not redesign the image.`,
  },
  {
    name: "Edit: Change the headline",
    description:
      "Attach the approved image and pick its original format. Swaps only the headline, keeping its font, size, and position.",
    prompt: `Edit the attached image.
Change ONLY the headline to "[NEW HEADLINE]".
Keep its font, position, size, color, and visual weight as close as possible.
Preserve every other element, including the subhead, product, logo, and layout.`,
  },
  {
    name: "Edit: Change a button",
    description:
      "Attach the approved image and pick its original format. Swaps only the button color and label.",
    prompt: `Edit the attached image.
Change ONLY the button background to [HEX] and its text to "[NEW LABEL]".
Keep the button's size, shape, position, and corner radius identical.
Keep everything else in the image unchanged.`,
  },
  {
    name: "Edit: Fix a name, date, or old copy",
    description:
      "Attach the approved image and pick its original format. Replaces old text and removes a phrase without redesigning.",
    prompt: `Edit the attached image.
Replace every instance of "[OLD TEXT]" with "[NEW EXACT TEXT]".
Remove "[PHRASE TO REMOVE]" wherever it appears.
Preserve the visual identity, palette, layout, imagery, and all other copy.
Fit the replacement naturally in the existing type style.
Do not redesign the image.`,
  },
  {
    name: "Edit: Restore lost energy",
    description:
      "Attach the drifted design and the approved reference. If repeated edits keep breaking things, restart from the original references.",
    prompt: `Edit the attached design to restore the [DESCRIBE THE ENERGY] of the attached approved reference. Keep the name, copy, and core idea.

Use [PRIMARY TREATMENT] across roughly 70-80% of the design, with [ACCENT COLORS] as sharp accents.
Keep texture local to photographs and edges so the colors stay clean.
Carry the attitude through scale and composition.

Avoid: a muddy global filter, faded washes, and the specific colors it drifted toward. Preserve the punch of the approved reference.`,
  },
  {
    name: "Event: Identity board",
    description:
      "Fill in the event brief, then paste one direction's visual brief. Attach style references and your real logos. Format: Landscape / YouTube (16:9).",
    prompt: `${EVENT_BRIEF}

Create one landscape visual identity board for this event.
Use the event brief above and this selected direction:
[PASTE THE VISUAL BRIEF]

Make this feel like one complete event brand.
Put the exact event name "[EVENT NAME]" prominently in the center, styled as the event's wordmark. Do not substitute the creative route name.

Arrange these six applications around it in a composed editorial layout:
1. A large hero poster.
2. The venue entrance with event signage.
3. A social announcement.
4. A cocktail menu.
5. A T-shirt someone would actually wear.
6. A room installation that brings the central idea to life.

Give the poster the most space. Use smaller supporting applications with clear separation. Carry the same typography, palette, signature device, and image style across all six. Adapt the design to each object.
Use only the supplied event copy. Keep secondary text minimal.

Avoid: six unrelated designs, equal-sized postage-stamp mockups, extra names or sponsors, filler paragraphs, illegible tiny copy, and generic mockups that lose the direction's personality.`,
  },
  {
    name: "Event: Single asset",
    description:
      "Fill in the event brief. Attach the winning identity board, your logo, and original references. One asset per generation.",
    prompt: `${EVENT_BRIEF}

Create one [ASSET: POSTER / SOCIAL POST / INVITATION / TICKET / WRISTBAND / COASTER / TOTE / T-SHIRT / COCKTAIL MENU / VENUE SIGN].
Output type: [FLAT ARTWORK / PHOTOREALISTIC MOCKUP].

Use the attached approved identity board as the design system.
Keep its exact event name, typography behavior, palette, image style, and signature device. Adapt the composition to this asset's shape.

Exact copy for this asset:
[PASTE ONLY THE COPY IT NEEDS]

Make [MOST IMPORTANT ELEMENT] the first thing people notice.
For flat artwork, fill the canvas with the design, without a room or object mockup.
For a mockup, apply it naturally to [OBJECT / LOCATION].

Avoid: redesigning the identity, importing names from old references, adding filler copy, fading the colors, or shrinking a whole poster onto an object that needs a simpler treatment.`,
  },
  {
    name: "Event: Pitch deck slide",
    description:
      "Fill in the event brief and paste one slide's brief and copy. Attach its concept board, plus your first approved slide for layout. Format: Landscape / YouTube (16:9).",
    prompt: `${EVENT_BRIEF}

Create one finished presentation slide using this slide brief:
[PASTE ONE SLIDE'S BRIEF AND EXACT COPY]

Use the attached concept board for the event's visual identity.
Use the attached approved slide, if supplied, for presentation typography, margins, and label styling. Keep these roles separate.

Recompose the visuals for the slide. Give the hero enough space to judge.
Keep the exact copy large and readable. Preserve the concept's colors, name, and signature device. Use only the requested applications.

Avoid: shrinking an entire board into a small box, giant empty margins, tiny paragraphs, changed dates, invented slogans, or mixing the visual identities of different event concepts.`,
  },
];

async function main() {
  const existing = await db
    .select({ name: imageTemplates.name })
    .from(imageTemplates)
    .where(isNull(imageTemplates.brandId));
  const taken = new Set(existing.map((t) => t.name));

  // The list page sorts newest first; step createdAt back one second per row so the
  // pack's order (ads first) is preserved on screen.
  const base = Date.now();
  const rows = TEMPLATES.map((t, i) => ({
    ...t,
    brandId: null,
    referenceUrls: [],
    createdAt: new Date(base - i * 1000),
  })).filter((t) => !taken.has(t.name));

  if (rows.length === 0) {
    console.log("All templates already exist. Nothing to insert.");
    return;
  }

  await db.insert(imageTemplates).values(rows);
  console.log(`Inserted ${rows.length} of ${TEMPLATES.length} image templates:`);
  for (const r of rows) console.log(`  ${r.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
