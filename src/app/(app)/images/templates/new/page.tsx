import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { imageTemplateFolders } from "@/db/schema";
import { getUserBrands, requireUser } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { FolderField } from "../folder-field";
import { createTemplate } from "../actions";

export default async function NewImageTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const user = await requireUser();
  const [brands, folders, { folder: folderParam }] = await Promise.all([
    getUserBrands(user),
    db.query.imageTemplateFolders.findMany({
      orderBy: [asc(imageTemplateFolders.name)],
    }),
    searchParams,
  ]);
  const sortedBrands = [...brands].sort((a, b) => a.name.localeCompare(b.name));

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-2">
        <Link
          href="/images/templates"
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
        >
          ← Back to templates
        </Link>
      </div>
      <PageHeader
        title="New image template"
        description="Save a baked-in prompt, reference image(s), or both. Using the template prefills Image Studio."
      />

      <form
        action={createTemplate}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Name
            <input
              name="name"
              required
              placeholder="e.g. Marble product hero"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Brand
            <select name="brandId" defaultValue="" className={inputCls}>
              <option value="">All brands</option>
              {sortedBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <FolderField
            folders={folders}
            defaultValue={folders.some((f) => f.id === folderParam) ? folderParam : ""}
            className={inputCls}
          />
        </div>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Description
          <input
            name="description"
            placeholder="Short note about when to use this template"
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Baked-in prompt
          <textarea
            name="prompt"
            rows={4}
            placeholder="e.g. Product centered on white marble, soft top-down light, subtle shadow, premium minimalist styling"
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Reference images (upload, optional if you wrote a prompt)
          <input
            type="file"
            name="files"
            accept="image/*"
            multiple
            className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          …or import from a product / collection URL (optional)
          <input
            name="importUrl"
            placeholder="https://acmeflorals.example/product/love-blossom"
            className={inputCls}
          />
        </label>

        <div className="flex items-center gap-3">
          <Button type="submit" label="Save template" variant="primary" />
          <Button href="/images/templates" label="Cancel" variant="secondary" />
        </div>
      </form>
    </div>
  );
}
