import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, type competitors } from "@/db/schema";
import { deleteCompetitor, saveCompetitor } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";
import { BrandMultiSelect } from "@/components/brand-multi-select";

export async function CompetitorForm({
  competitor,
}: {
  competitor?: typeof competitors.$inferSelect;
}) {
  const allBrands = await db.query.brands.findMany({
    orderBy: [asc(brands.name)],
  });

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  return (
    <form action={saveCompetitor} className="space-y-5">
      {competitor && <input type="hidden" name="id" value={competitor.id} />}

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Competitor name
        <input
          name="name"
          required
          defaultValue={competitor?.name}
          placeholder="Flower Depot"
          className={inputCls}
        />
      </label>

      <div className="flex flex-col gap-1 text-xs text-zinc-600">
        Applies to brands
        <BrandMultiSelect
          brands={allBrands}
          selected={competitor?.brandIds ?? []}
        />
        <p className="text-zinc-500">
          Leave empty to apply to <strong>all brands</strong>.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Domain
        <input
          name="domain"
          defaultValue={competitor?.domain}
          placeholder="flowerdepot.ph"
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Notes (positioning, strengths, price tier — injected into prompts)
        <textarea
          name="notes"
          rows={6}
          defaultValue={competitor?.notes}
          placeholder={"Premium positioning, same-day delivery in Metro Manila, higher price point. Strong on wedding arrangements."}
          className={`${inputCls} leading-relaxed`}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={competitor?.isActive ?? true}
        />
        Active (included in prompts)
      </label>

      <div className="flex items-center gap-3">
        <Button label="Save competitor" variant="primary" type="submit" />
        {competitor && (
          <ConfirmSubmitButton
            formAction={deleteCompetitor}
            message={`Delete “${competitor.name}”? This cannot be undone.`}
            label="Delete"
          />
        )}
      </div>
    </form>
  );
}
