/**
 * Model defaults for the newsletter surface.
 *
 * `PLANNER_MODEL` is CHOSEN from the model list rather than hardcoded, because
 * a hardcoded id silently breaks when the list changes: pinning
 * "anthropic/claude-opus-5" typechecked locally against an updated models.ts
 * but failed the deployed build, where that id does not exist — and before it
 * failed, it left the dropdown matching no option at all, which read as a
 * broken default rather than a missing model.
 *
 * Picking the first preference that is actually present means this keeps
 * working across model-roster changes in either direction.
 */
import { MODEL_OPTIONS } from "@/lib/models";
import type { ImageModelId } from "@/lib/image-model-options";

/**
 * Best writer first. The planner produces customer-facing copy, so it should
 * get the strongest model on the roster, not the cheap chat default.
 */
const PLANNER_PREFERENCE = [
  "anthropic/claude-opus-5",
  "anthropic/claude-opus-4-8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.6-sol",
] as const;

export const PLANNER_MODEL: string =
  PLANNER_PREFERENCE.find((id) => MODEL_OPTIONS.some((m) => m.id === id)) ??
  MODEL_OPTIONS[0].id;

/** Hero visuals: Sunburst is the image studio's own pick for hero shots. */
// Typed so dropping either from IMAGE_MODEL_OPTIONS fails the build.
export const HERO_MODEL = "openai/gpt-image-2.6-sunburst" satisfies ImageModelId;
export const HERO_MODEL_FAST = "openai/gpt-image-2.6-flare" satisfies ImageModelId;
