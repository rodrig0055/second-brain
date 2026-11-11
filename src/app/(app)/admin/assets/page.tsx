import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { brandAssets, brands } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { addAsset, deleteAsset } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";

export default async function AdminAssetsPage() {
  await requireAdmin();
  const [allBrands, assets] = await Promise.all([
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
    db.query.brandAssets.findMany({
      orderBy: [desc(brandAssets.createdAt)],
      with: { brand: true },
    }),
  ]);

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none";

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-sm font-medium text-zinc-700">
          Add brand reference image
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Reusable references (logos, product shots, style examples) that appear
          as toggles in Image Studio for that brand.
        </p>
        <form
          action={addAsset}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Brand
            <select name="brandId" required className={inputCls}>
              {allBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Label
            <input name="label" placeholder="e.g. Logo white" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Image
            <input
              type="file"
              name="file"
              accept="image/*"
              required
              className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-zinc-700"
            />
          </label>
          <Button label="Upload" variant="primary" type="submit" />
        </form>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-700">
          Assets ({assets.length})
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <div
              key={a.id}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" decoding="async" src={a.url} alt={a.label} className="aspect-square w-full object-cover" />
              <div className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-zinc-700">{a.label || "N/A"}</p>
                  <p className="truncate text-zinc-500">{a.brand.name}</p>
                </div>
                <form action={deleteAsset}>
                  <input type="hidden" name="id" value={a.id} />
                  <ConfirmSubmitButton
                    message={`Delete “${a.label || "this asset"}”? This cannot be undone.`}
                    label="Delete"
                  />
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
