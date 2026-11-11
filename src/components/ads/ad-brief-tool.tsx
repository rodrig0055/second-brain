"use client";

import { useActionState, useState } from "react";
import { Button } from "@astryxdesign/core/Button";

import {
  suggestDrafts,
  type BriefState,
} from "@/app/(app)/t/[team]/ads/brief-actions";
import { createDraft } from "@/app/(app)/t/[team]/ads/draft-actions";
import { DatePicker, isDateField } from "@/components/date-picker";
import type { TemplateInputField } from "@/db/schema";
import { CTA_OPTIONS } from "@/lib/ads/drafts/fields";

/**
 * The ad brief.
 *
 * Left: what you want to achieve, in the template's own words. Right: drafts
 * written from the account's last 30 days, each one editable and each one
 * saved by a person, not by the model.
 *
 * The suggestion is never the artefact. Every field below is an input in the
 * form that writes the pipeline row, so accepting a draft and correcting one
 * are the same gesture, and nothing reaches Meta without someone having read
 * it. What the model chose is shown next to what it leaned on, so a number in
 * a rationale can be checked against the table on the ads page.
 */

const INPUT_CLS =
  "u-transition w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

const INITIAL: BriefState = { status: "idle" };

type Brand = { id: string; name: string };

export function AdBriefTool({
  teamSlug,
  templateId,
  fields,
  brands,
  models,
  templateModel,
}: {
  teamSlug: string;
  templateId: string;
  fields: TemplateInputField[];
  brands: Brand[];
  models: { id: string; label: string }[];
  templateModel: string;
}) {
  const [state, formAction, pending] = useActionState(suggestDrafts, INITIAL);
  const [model, setModel] = useState(templateModel);

  const inputs = state.inputs ?? {};

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-10">
      <form
        action={formAction}
        className="space-y-4 lg:sticky lg:top-8 lg:self-start"
      >
        <input type="hidden" name="team" value={teamSlug} />
        <input type="hidden" name="templateId" value={templateId} />

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Brand
          <select
            name="brandId"
            required
            defaultValue={state.brandId}
            className={INPUT_CLS}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Model
          <select
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={INPUT_CLS}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {fields.map((f) => (
          <label
            key={f.name}
            className="flex flex-col gap-1 text-xs text-zinc-600"
          >
            {f.label || f.name}
            {f.type === "textarea" ? (
              <textarea
                name={f.name}
                required={f.required}
                rows={4}
                defaultValue={inputs[f.name]}
                placeholder={f.placeholder}
                className={INPUT_CLS}
              />
            ) : f.type === "select" ? (
              <select
                name={f.name}
                required={f.required}
                defaultValue={inputs[f.name]}
                className={INPUT_CLS}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : isDateField(f) ? (
              <DatePicker
                name={f.name}
                label={f.label || f.name}
                defaultValue={inputs[f.name]}
                required={f.required}
                placeholder={f.placeholder || "Pick a date"}
              />
            ) : (
              <input
                name={f.name}
                type={f.type === "number" ? "number" : "text"}
                required={f.required}
                defaultValue={inputs[f.name]}
                placeholder={f.placeholder}
                className={INPUT_CLS}
              />
            )}
          </label>
        ))}

        <Button
          type="submit"
          label={pending ? "Reading the account…" : "Suggest drafts"}
          variant="primary"
          width="100%"
          isDisabled={pending}
        />

        <p className="text-[0.6875rem] leading-4 text-zinc-400">
          Reads the last 30 days of this account from what the nightly sync
          already stored: spend, purchases and CIR per funnel, the ads that sold
          and the ads that did not, and the ad sets currently delivering.
        </p>
      </form>

      <div className="min-w-0 space-y-4">
        {state.status === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        )}

        {state.status === "idle" && (
          <div className="rounded-xl border border-dashed border-zinc-300 px-5 py-12 text-center">
            <p className="text-sm font-medium text-zinc-800">
              Say what the ad is for
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">
              The concept, the funnel, the ad set, the headline and the caption
              come back filled in from what has actually sold in this account.
              You edit them, then save the ones worth running.
            </p>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
              <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                What this was written from
              </h2>
              <p className="mt-1 text-sm text-zinc-800">{state.spendLabel}</p>
              <p className="text-xs text-zinc-500">{state.windowLabel}</p>
              {(state.funnels ?? []).length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {state.funnels!.map((f) => (
                    <li key={f.funnel} className="text-xs text-zinc-600">
                      <span className="font-medium text-zinc-700">
                        {f.funnel}
                      </span>{" "}
                      · {f.ads} ads · CIR{" "}
                      {f.cir > 0 ? `${f.cir.toFixed(0)}%` : "n/a"}
                      {f.targetCirPct ? ` vs ${f.targetCirPct}% target` : ""}
                      {f.targetCirPct && !f.targetConfirmed && (
                        <span className="text-amber-700">
                          {" "}
                          (target unconfirmed)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {state.note && (
                <p className="mt-2 border-t border-zinc-100 pt-2 text-xs italic text-zinc-600">
                  {state.note}
                </p>
              )}
            </section>

            {(state.variants ?? []).map((v, i) => (
              <VariantCard
                key={`${v.concept}-${i}`}
                variant={v}
                index={i}
                teamSlug={teamSlug}
                state={state}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  index,
  teamSlug,
  state,
}: {
  variant: NonNullable<BriefState["variants"]>[number];
  index: number;
  teamSlug: string;
  state: BriefState;
}) {
  const inputs = state.inputs ?? {};
  const errors = variant.findings.filter((f) => f.severity === "error");
  const warns = variant.findings.filter((f) => f.severity === "warn");
  const adSets = state.adSets ?? [];

  return (
    <form
      action={createDraft}
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card"
    >
      <input type="hidden" name="team" value={teamSlug} />
      <input type="hidden" name="brandId" value={state.brandId ?? ""} />
      <input type="hidden" name="goto" value="queue" />
      <input type="hidden" name="purpose" value={inputs.purpose ?? "BAU"} />
      <input type="hidden" name="eventDate" value={inputs.eventDate ?? ""} />
      <input type="hidden" name="funnels" value={variant.funnel} />

      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-zinc-600">
          Option {index + 1}
        </span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.625rem] text-zinc-600">
          {variant.funnel}
        </span>
      </div>

      <div className="space-y-3">
        <Field label="Concept">
          <input
            name="concept"
            defaultValue={variant.concept}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Headline">
          <input
            name="headline"
            defaultValue={variant.headline}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Primary text">
          <textarea
            name="primaryText"
            rows={4}
            defaultValue={variant.primaryText}
            className={INPUT_CLS}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Ad set">
            <select
              name="targetAdSetId"
              defaultValue={variant.targetAdSetId}
              className={INPUT_CLS}
            >
              <option value="">Choose an ad set</option>
              {adSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.funnel ?? "unmapped"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Button">
            <select
              name="callToAction"
              defaultValue={variant.callToAction}
              className={INPUT_CLS}
            >
              {CTA_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Link">
          <input
            name="linkUrl"
            defaultValue={inputs.linkUrl ?? ""}
            placeholder="https://…"
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Notes for whoever makes the assets">
          <textarea
            name="notes"
            rows={3}
            defaultValue={[variant.assetDirection, variant.rationale]
              .filter(Boolean)
              .join("\n\n")}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      {variant.adSetWarning && (
        <p className="mt-2 text-xs text-amber-700">{variant.adSetWarning}</p>
      )}
      {errors.map((f, i) => (
        <p key={`e${i}`} className="mt-2 text-xs text-red-600">
          {f.message}
        </p>
      ))}
      {warns.map((f, i) => (
        <p key={`w${i}`} className="mt-1 text-xs text-amber-700">
          {f.message}
        </p>
      ))}

      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" label="Add to pipeline" variant="primary" size="sm" />
        <span className="text-[0.6875rem] text-zinc-400">
          Saved as requested. It still needs a 1:1 and a 9:16 before it can run.
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600">
      {label}
      {children}
    </label>
  );
}
