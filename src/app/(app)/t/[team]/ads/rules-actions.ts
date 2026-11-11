"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { adRules, integrationConnections } from "@/db/schema";
import { adsPath, requireAdsBrand } from "@/lib/ads/access";
import { DEFAULT_RULES, BENCHMARK_SOURCE } from "@/lib/ads/rules/defaults";
import { moneyFields, parseRuleParams } from "@/lib/ads/rules/params";
import type { RuleKind } from "@/lib/ads/rules/types";
import type { AdsFormState } from "./actions";

/**
 * Editing the thresholds an alert is judged against.
 *
 * The thirteen rules shipped with one brand's numbers and no way to change
 * them, so every alert on every other account read "inherited from Acme Florals
 * PH, not measured here" forever, and nobody could make it stop saying that.
 * Confirming is a separate act from editing on purpose: agreeing with a
 * borrowed number is a decision worth recording.
 */

async function connectionFor(teamSlug: string, brandId: string) {
  const { user } = await requireAdsBrand(teamSlug, brandId);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  return { user, connection };
}

export async function updateRule(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");

  const { connection } = await connectionFor(teamSlug, brandId);
  if (!connection) return { error: "No Meta account connected for this brand." };

  const rule = await db.query.adRules.findFirst({ where: eq(adRules.id, ruleId) });
  if (!rule || rule.connectionId !== connection.id) {
    return { error: "That rule is not on this account." };
  }

  const kind = rule.kind as RuleKind;
  const input: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("param.")) input[key.slice("param.".length)] = value;
  }

  const parsed = parseRuleParams(kind, input);
  if (!parsed.ok) return { error: parsed.error };

  const currency = String(connection.config?.currency ?? "USD");
  const money = moneyFields(kind);
  if (money.length && rule.currency !== currency) {
    return {
      error: `This rule's thresholds are in ${rule.currency} but the account reports in ${currency}. Set them again in ${currency}.`,
    };
  }

  const funnels = formData.getAll("funnels").map(String).filter(Boolean);

  await db
    .update(adRules)
    .set({
      enabled: formData.get("enabled") === "on",
      includeEventAdSets: formData.get("includeEventAdSets") === "on",
      // Empty means every funnel, which is how the evaluator reads it.
      funnels,
      params: parsed.params,
      currency: money.length ? currency : rule.currency,
      updatedAt: new Date(),
    })
    .where(eq(adRules.id, ruleId));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Saved. The next run judges against it." };
}

/** Say that this threshold is right for this account, not borrowed. */
export async function confirmRule(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const ruleId = String(formData.get("ruleId") ?? "");

  const { user, connection } = await connectionFor(teamSlug, brandId);
  if (!connection) return { error: "No Meta account connected for this brand." };

  await db
    .update(adRules)
    .set({ confirmedAt: new Date(), confirmedById: user.id, updatedAt: new Date() })
    .where(and(eq(adRules.id, ruleId), eq(adRules.connectionId, connection.id)));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Confirmed for this account." };
}

export async function confirmAllRules(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");

  const { user, connection } = await connectionFor(teamSlug, brandId);
  if (!connection) return { error: "No Meta account connected for this brand." };

  await db
    .update(adRules)
    .set({ confirmedAt: new Date(), confirmedById: user.id, updatedAt: new Date() })
    .where(eq(adRules.connectionId, connection.id));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "All thresholds confirmed for this account." };
}

/**
 * Put the default rules on an account that has none.
 *
 * Money thresholds arrive in USD, so on an account reporting in anything else
 * those rules are seeded switched off: a peso account judged against dollar
 * numbers would fire on almost everything, and a wall of wrong alerts teaches
 * people to ignore the list.
 */
export async function seedDefaultRules(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");

  const { connection } = await connectionFor(teamSlug, brandId);
  if (!connection) return { error: "No Meta account connected for this brand." };

  const currency = String(connection.config?.currency ?? "USD");
  const foreign = currency !== "USD";

  let created = 0;
  let disabled = 0;
  for (const rule of DEFAULT_RULES) {
    const hasMoney = moneyFields(rule.kind).length > 0;
    const enabled = !(hasMoney && foreign);
    const inserted = await db
      .insert(adRules)
      .values({
        connectionId: connection.id,
        brandId,
        key: rule.key,
        kind: rule.kind,
        label:
          hasMoney && foreign
            ? `${rule.label} — set the thresholds in ${currency} and enable`
            : rule.label,
        enabled,
        level: rule.level,
        funnels: rule.funnels ?? [],
        includeEventAdSets: rule.includeEventAdSets ?? false,
        params: rule.params,
        currency: "USD",
        source: BENCHMARK_SOURCE,
      })
      .onConflictDoNothing()
      .returning({ id: adRules.id });
    if (inserted.length) {
      created += 1;
      if (!enabled) disabled += 1;
    }
  }

  revalidatePath(adsPath(teamSlug), "layout");
  if (created === 0) return { ok: "Every default rule is already here." };
  return {
    ok: disabled
      ? `Added ${created} rules. ${disabled} carry money thresholds in USD and are off until you set them in ${currency}.`
      : `Added ${created} rules.`,
  };
}
