import "server-only";

import { generateObject } from "ai";
import { z } from "zod";

import type { OutputKind } from "@/lib/image-output";
import {
  BRIEF_KINDS,
  ruleSettings,
  settingsFromKind,
  type BriefKind,
  type ImageSettings,
} from "@/lib/image-settings";
import { PASS_MODELS, resolveModel } from "@/lib/models";
import { logUsage } from "@/lib/usage";

// Two closed questions over the same state, answered together. The model only
// classifies; the settings and the reason shown to the person are mapped in
// code (settingsFromKind), so a model can never invent a setting.
const schema = z.object({
  kind: z.enum(Object.keys(BRIEF_KINDS) as [BriefKind, ...BriefKind[]]),
  fineDetail: z.boolean(),
});

const SYSTEM =
  `You read creative briefs for an image generator used by a flower and gift shop's marketing team. ` +
  `Answer two questions about the brief. Use only what the brief says.\n\n` +
  `1. kind: which one best describes what the brief asks for? Decide edit versus the rest with one test: ` +
  `would the finished image be one of the attached pictures with changes (edit), or a picture that did not exist before ` +
  `(product_scene, layout or open)? Words like "create", "generate", "lifestyle image of" or a new setting, person or concept ` +
  `mean a new picture even when references are attached.\n` +
  Object.entries(BRIEF_KINDS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n") +
  `\nIf the brief mentions attached images but no reference images are attached, read it as if they were not mentioned.\n\n` +
  `2. fineDetail: true when the finished image must show legible text (any quoted words, prices, discounts, promo codes, dates or labels), ` +
  `a logo that has to be reproduced, or many small objects that must each be recognisable. False otherwise.`;

const TIMEOUT_MS = 8_000;

/**
 * Pick 2.6 settings for a brief. Rules first, then a cheap classifier with a
 * fallback on another provider. If both fail it still answers (medium with
 * references: faithful enough to protect the product, loose enough to compose),
 * so a run never waits on this.
 */
export async function decideImageSettings(args: {
  brief: string;
  hasReferences: boolean;
  output: OutputKind;
  userId?: string;
  brandId?: string;
  /** Override the model chain (evaluation only). */
  models?: string[];
}): Promise<ImageSettings> {
  const ruled = ruleSettings(args);
  if (ruled) return ruled;

  const prompt =
    `Reference images attached: ${args.hasReferences ? "yes" : "no"}\n` +
    `Brief:\n"""\n${args.brief.slice(0, 4000)}\n"""`;

  for (const id of args.models ?? [PASS_MODELS.imageSettings, PASS_MODELS.imageSettingsFallback]) {
    try {
      const model = await resolveModel(id);
      const r = await generateObject({
        model,
        schema,
        system: SYSTEM,
        prompt,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await logUsage({
        kind: "task",
        model: id,
        usage: r.usage,
        userId: args.userId,
        brandId: args.brandId,
      });
      return settingsFromKind(r.object.kind, r.object.fineDetail, args.hasReferences);
    } catch (err) {
      console.error("image settings classifier failed", id, err);
    }
  }

  return args.hasReferences
    ? {
        complexity: "medium",
        fineDetail: false,
        source: "rule",
        reason: "Couldn't read the brief, so medium: keeps your product faithful.",
      }
    : {
        complexity: "high",
        fineDetail: false,
        source: "rule",
        reason: "No references to keep exact, so the model plans fully.",
      };
}
