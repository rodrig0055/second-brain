// GPT Image 2.6 render settings the studio picks per run: how much the model
// plans before drawing (`complexity`) and whether to render fine detail
// (`quality` one step up). Client-safe: the studio shows the decision, the
// routes validate it, image-models applies it.
//
// OpenAI's guidance (image prompting guide, Nov 2026): `low` for changing one
// detail of an image while keeping the rest; `high` (the default) when the
// brief leaves design open or has dense text, layout and object relationships.
// Higher complexity "can introduce unwanted changes", which for a florist means
// a different bouquet than the one in the reference.

import type { OutputKind } from "@/lib/image-output";

export const COMPLEXITIES = ["low", "medium", "high"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  low: "Low planning: keep references exact",
  medium: "Medium planning: new scene, faithful product",
  high: "High planning: let the model design",
};

/**
 * What a brief asks for, as the classifier reads it. The criteria are the
 * contract: they are sent to the model verbatim, so edit them here only.
 */
export const BRIEF_KINDS = {
  edit:
    "The result is one of the attached images with specific changes and everything else kept: swap or replace an item in it, replace or rewrite its text, resize, upscale or reframe it, change its background, recolour, change a person's pose, face or clothing in it, add or remove one element.",
  product_scene:
    "The result is a new photo or scene (new setting, new people, new styling or campaign concept) in which an attached product, person or logo must appear faithfully. The attached images are ingredients, not the picture being edited.",
  layout:
    "The result is a new designed graphic built from scratch: readable text, prices, promo codes, logos, several products arranged together, a poster, banner, collage or infographic.",
  open:
    "Composition is left to the model: mood, style or inspiration without a strict product, text or layout requirement.",
} as const;
export type BriefKind = keyof typeof BRIEF_KINDS;

export type ImageSettings = {
  complexity: Complexity;
  /** Render one quality step higher for legible text and small detail. */
  fineDetail: boolean;
  /** Who decided: a fixed rule, the brief classifier, or the person. */
  source: "rule" | "auto" | "manual";
  /** One line for the studio, saying why. */
  reason: string;
};

/** The default when nothing has decided: OpenAI's own default. */
export const DEFAULT_SETTINGS: ImageSettings = {
  complexity: "high",
  fineDetail: false,
  source: "rule",
  reason: "Default planning.",
};

/**
 * Decisions that need no model. GIF and SVG plan fully: an animation is new
 * motion even from a reference, and SVG takes none. Returns null when the brief has
 * to be read.
 */
export function ruleSettings(args: {
  hasReferences: boolean;
  output: OutputKind;
}): ImageSettings | null {
  if (args.output !== "image") {
    return {
      complexity: "high",
      fineDetail: false,
      source: "rule",
      reason:
        args.output === "gif"
          ? "An animation composes new motion, so the model plans fully."
          : "SVG is composed from scratch, so the model plans fully.",
    };
  }
  // Still images are always read: with references for how faithful to stay,
  // without them still for whether there is text that needs fine detail.
  return null;
}

/** Map the classifier's reading of a brief to settings, with a reason to show. */
export function settingsFromKind(
  kind: BriefKind,
  fineDetail: boolean,
  hasReferences: boolean,
): ImageSettings {
  const detail = fineDetail ? " Text or small detail, so rendered one quality step higher." : "";
  if (!hasReferences) {
    return {
      complexity: "high",
      fineDetail,
      source: "auto",
      reason: `No references to keep exact, so the model plans the whole composition.${detail}`,
    };
  }
  const byKind: Record<BriefKind, [Complexity, string]> = {
    edit: ["low", "You're editing a reference, so the rest of it is kept exact."],
    product_scene: ["medium", "A new scene around your product: room to compose, product kept faithful."],
    layout: ["high", "A designed layout, so the model plans text and placement fully."],
    open: ["high", "The brief leaves the design open, so the model plans fully."],
  };
  const [complexity, why] = byKind[kind];
  return { complexity, fineDetail, source: "auto", reason: `${why}${detail}` };
}

/** Settings the person chose in the studio, keeping the auto detail call. */
export function manualSettings(complexity: Complexity, fineDetail: boolean): ImageSettings {
  return { complexity, fineDetail, source: "manual", reason: "Set by you." };
}

/** Validate settings sent back by the studio. Anything malformed is dropped. */
export function parseSettings(raw: unknown): ImageSettings | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const v = JSON.parse(raw) as Partial<ImageSettings>;
    if (!COMPLEXITIES.includes(v.complexity as Complexity)) return null;
    if (!["rule", "auto", "manual"].includes(String(v.source))) return null;
    return {
      complexity: v.complexity as Complexity,
      fineDetail: v.fineDetail === true,
      source: v.source as ImageSettings["source"],
      reason: String(v.reason ?? "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

/** Whether a model takes these settings at all (2.5 rejects `complexity`). */
export function takesSettings(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-image-2.6");
}

/** Caption suffix for an output, e.g. " · low planning (auto)". Empty when none. */
export function planningCaption(settings?: { complexity: string; source: string }): string {
  if (!settings) return "";
  const who = settings.source === "manual" ? "set by you" : "auto";
  return ` · ${settings.complexity} planning (${who})`;
}
