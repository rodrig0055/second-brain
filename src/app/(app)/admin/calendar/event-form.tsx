import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, type calendarEvents } from "@/db/schema";
import { deleteEvent, saveEvent } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";
import { BrandMultiSelect } from "@/components/brand-multi-select";

export async function EventForm({
  event,
}: {
  event?: typeof calendarEvents.$inferSelect;
}) {
  const allBrands = await db.query.brands.findMany({
    orderBy: [asc(brands.name)],
  });

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  return (
    <form action={saveEvent} className="space-y-5">
      {event && <input type="hidden" name="id" value={event.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Event name
          <input
            name="name"
            required
            defaultValue={event?.name}
            placeholder="Mother's Day (PH)"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Date
          <input
            type="date"
            name="date"
            required
            defaultValue={event?.date}
            className={inputCls}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 text-xs text-zinc-600">
        Applies to brands
        <BrandMultiSelect brands={allBrands} selected={event?.brandIds ?? []} />
        <p className="text-zinc-500">
          Leave empty for a <strong>global</strong> event (all brands).
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Notes (optional context — injected into prompts)
        <textarea
          name="notes"
          rows={4}
          defaultValue={event?.notes}
          placeholder={"Peak gifting window. Push bouquets + same-day delivery; start teasers ~2 weeks prior."}
          className={`${inputCls} leading-relaxed`}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="recurring"
          defaultChecked={event?.recurring ?? false}
        />
        Repeats annually (same month/day every year)
      </label>
      <p className="-mt-3 text-xs text-zinc-500">
        Tick for fixed holidays (Valentine&rsquo;s, Christmas). Leave off for
        one-off dates or floating holidays (e.g. Mother&rsquo;s Day) — set the
        exact date and update it each year.
      </p>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={event?.isActive ?? true}
        />
        Active (included in prompts)
      </label>

      <div className="flex items-center gap-3">
        <Button label="Save event" variant="primary" type="submit" />
        {event && (
          <ConfirmSubmitButton
            formAction={deleteEvent}
            message={`Delete “${event.name}”? This cannot be undone.`}
            label="Delete"
          />
        )}
      </div>
    </form>
  );
}
