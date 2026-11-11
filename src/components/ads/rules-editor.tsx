"use client";

import { useActionState } from "react";
import { Button } from "@astryxdesign/core/Button";

import { RULE_PARAMS, moneyFields } from "@/lib/ads/rules/params";
import type { RuleKind } from "@/lib/ads/rules/types";
import {
  confirmAllRules,
  confirmRule,
  seedDefaultRules,
  updateRule,
} from "@/app/(app)/t/[team]/ads/rules-actions";
import type { AdsFormState } from "@/app/(app)/t/[team]/ads/actions";
import { ToneTag } from "@/components/status-badge";

/**
 * What an alert means, for this account.
 *
 * Confirming is separate from editing because they are different statements: a
 * borrowed threshold that happens to be right still needs somebody to say so,
 * and until they do every alert it raises carries the caveat.
 */

export type EditableRule = {
  id: string;
  key: string;
  kind: RuleKind;
  label: string;
  enabled: boolean;
  level: string;
  funnels: string[];
  includeEventAdSets: boolean;
  params: Record<string, number>;
  currency: string;
  source: string;
  confirmedAt: string | null;
};

const EMPTY: AdsFormState = {};

export function RulesEditor({
  rules,
  teamSlug,
  brandId,
  brandName,
  currency,
}: {
  rules: EditableRule[];
  teamSlug: string;
  brandId: string;
  brandName: string;
  currency: string;
}) {
  const [seedState, seed, seeding] = useActionState(seedDefaultRules, EMPTY);
  const [allState, confirmAll, confirmingAll] = useActionState(confirmAllRules, EMPTY);

  const unconfirmed = rules.filter((r) => !r.confirmedAt).length;

  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center">
        <p className="text-sm font-medium text-zinc-800">No rules on {brandName} yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
          Nothing is being judged on this account. The thirteen defaults come from
          Acme Florals PH and are a starting point, not a measurement of this brand.
        </p>
        <form action={seed} className="mt-4">
          <input type="hidden" name="team" value={teamSlug} />
          <input type="hidden" name="brandId" value={brandId} />
          <Button
            type="submit"
            label="Add the default rules"
            variant="primary"
            size="sm"
            isDisabled={seeding}
          />
        </form>
        {seedState.error && <p className="mt-2 text-[0.7rem] text-red-600">{seedState.error}</p>}
        {seedState.ok && <p className="mt-2 text-[0.7rem] text-emerald-700">{seedState.ok}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {unconfirmed > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-[0.7rem] text-amber-800">
            {unconfirmed} of {rules.length} thresholds are still the borrowed ones. Every alert
            they raise says so.
          </p>
          <form action={confirmAll}>
            <input type="hidden" name="team" value={teamSlug} />
            <input type="hidden" name="brandId" value={brandId} />
            <Button
              type="submit"
              label={`These are right for ${brandName}`}
              size="sm"
              isDisabled={confirmingAll}
            />
          </form>
          {allState.ok && <span className="text-[0.7rem] text-emerald-700">{allState.ok}</span>}
        </div>
      )}

      {rules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          teamSlug={teamSlug}
          brandId={brandId}
          currency={currency}
        />
      ))}
    </div>
  );
}

function RuleCard({
  rule,
  teamSlug,
  brandId,
  currency,
}: {
  rule: EditableRule;
  teamSlug: string;
  brandId: string;
  currency: string;
}) {
  const [saveState, save, saving] = useActionState(updateRule, EMPTY);
  const [confirmState, confirm, confirming] = useActionState(confirmRule, EMPTY);
  const fields = RULE_PARAMS[rule.kind] ?? [];
  const money = new Set(moneyFields(rule.kind));

  const hidden = (
    <>
      <input type="hidden" name="team" value={teamSlug} />
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="ruleId" value={rule.id} />
    </>
  );

  return (
    <form
      action={save}
      className={`rounded-xl border bg-white p-3 shadow-card ${
        rule.enabled ? "border-zinc-200" : "border-zinc-200 opacity-70"
      }`}
    >
      {hidden}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-800">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={rule.enabled}
            className="size-3.5 rounded border-zinc-300"
          />
          {rule.label}
        </label>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.65rem] text-zinc-500">
          {rule.level}
        </span>
        {rule.confirmedAt ? (
          <ToneTag tone="success" label="Confirmed for this account" />
        ) : (
          <ToneTag tone="attention" tooltip={rule.source ?? undefined} label="Borrowed threshold" />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {fields.map((field) => (
          <label key={field.key} className="text-[0.7rem] text-zinc-500">
            {field.label}
            {money.has(field.key) && <span className="text-zinc-400"> ({currency})</span>}
            <input
              type="number"
              name={`param.${field.key}`}
              defaultValue={rule.params[field.key] ?? field.min}
              min={field.min}
              max={field.max}
              step={field.step}
              title={field.hint}
              className="mt-1 block h-8 w-28 rounded-md border border-zinc-200 px-2 text-xs tabular-nums"
            />
          </label>
        ))}

        <fieldset className="text-[0.7rem] text-zinc-500">
          <legend className="mb-1">Applies to</legend>
          <span className="flex gap-2">
            {["TOF", "MOF", "BOF"].map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="funnels"
                  value={f}
                  defaultChecked={rule.funnels.includes(f)}
                  className="size-3.5 rounded border-zinc-300"
                />
                {f}
              </label>
            ))}
          </span>
          <span className="mt-0.5 block text-[0.6rem] text-zinc-400">none ticked = all</span>
        </fieldset>

        <label className="flex items-center gap-1.5 text-[0.7rem] text-zinc-500">
          <input
            type="checkbox"
            name="includeEventAdSets"
            defaultChecked={rule.includeEventAdSets}
            className="size-3.5 rounded border-zinc-300"
          />
          Include event ad sets
        </label>

        <div className="grow" />
        <Button type="submit" label="Save" variant="primary" size="sm" isDisabled={saving} />
      </div>

      {(saveState.error || saveState.ok || confirmState.ok) && (
        <p
          className={`mt-2 text-[0.7rem] ${saveState.error ? "text-red-600" : "text-emerald-700"}`}
        >
          {saveState.error ?? saveState.ok ?? confirmState.ok}
        </p>
      )}

      {!rule.confirmedAt && (
        <p className="mt-2 flex items-center gap-2 text-[0.65rem] text-zinc-400">
          {rule.source}
          <Button
            type="submit"
            {...({ formAction: confirm } as object)}
            label="Right for this account"
            size="sm"
            isDisabled={confirming}
          />
        </p>
      )}
    </form>
  );
}
