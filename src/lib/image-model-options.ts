// Client-safe image-model metadata. Deliberately free of server-only imports
// (no db, no AI SDK) so client components can import it without dragging the
// database (and `process.env.DATABASE_URL`) into the browser bundle.

// First entry is the studio's default selection. `hint` is the "when to pick
// this" line shown on each row of the model dropdown, so keep the four
// comparable in length and grounded in what the model actually does (see
// image-models.ts for the size and quality each one is sent). `short` is for
// the dropdown's summary when several models are picked at once.
export const IMAGE_MODEL_OPTIONS = [
  {
    id: "openai/gpt-image-2.6-flare",
    label: "GPT Image 2.6 Flare (OpenAI)",
    short: "2.6 Flare",
    hint: "Fast everyday default, OpenAI's newest. Renders at the exact ratio for every format.",
  },
  {
    id: "openai/gpt-image-2.6-sunburst",
    label: "GPT Image 2.6 Sunburst (OpenAI)",
    short: "2.6 Sunburst",
    hint: "Most capable, run at xhigh quality. For hero shots, fine detail and text in frame. Slower and pricier.",
  },
  {
    id: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare (OpenAI)",
    short: "2.5 Flare",
    hint: "Previous fast model. Keep for side-by-side checks against 2.6.",
  },
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst (OpenAI)",
    short: "2.5 Sunburst",
    hint: "Previous top model at xhigh quality. Keep for side-by-side checks against 2.6.",
  },
  {
    id: "openai/gpt-image-2",
    label: "GPT Image 2 (OpenAI)",
    short: "GPT Image 2",
    hint: "Previous OpenAI model. Only has three fixed sizes, so story and wide formats need cropping.",
  },
  {
    id: "google/gemini-nano-banana-2.1",
    label: "Nano Banana 2.1 (Gemini)",
    short: "Nano Banana 2.1",
    hint: "Gemini's model, for a different look. Framing snaps to 1:1, 3:4, 4:3, 9:16 or 16:9.",
  },
] as const;

export type ImageModelId = (typeof IMAGE_MODEL_OPTIONS)[number]["id"];

export function imageModelLabel(id: string): string {
  return IMAGE_MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id;
}
