import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { imageTemplateFolders, imageTemplates } from "@/db/schema";
import { getUserBrands, requireUser } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { FolderField } from "../folder-field";
import { deleteTemplate, updateTemplate } from "../actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

export default async function EditImageTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [brands, template, folders] = await Promise.all([
    getUserBrands(user),
    db.query.imageTemplates.findFirst({ where: eq(imageTemplates.id, id) }),
    db.query.imageTemplateFolders.findMany({
      orderBy: [asc(imageTemplateFolders.name)],
    }),
  ]);
  if (!template) notFound();
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
        title="Edit image template"
        description="Update the prompt, brand, and reference images. Using the template prefills Image Studio."
      />

      <form
        action={updateTemplate}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5"
      >
        <input type="hidden" name="id" value={template.id} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Name
            <input
              name="name"
              required
              defaultValue={template.name}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Brand
            <select
              name="brandId"
              defaultValue={template.brandId ?? ""}
              className={inputCls}
            >
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
            defaultValue={template.folderId}
            className={inputCls}
          />
        </div>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Description
          <input
            name="description"
            defaultValue={template.description}
            placeholder="Short note about when to use this template"
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Baked-in prompt
          <textarea
            name="prompt"
            rows={4}
            defaultValue={template.prompt}
            className={inputCls}
          />
        </label>

        {template.referenceUrls.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-xs text-zinc-600">
              Reference images, uncheck to remove
            </legend>
            <div className="flex flex-wrap gap-3">
              {template.referenceUrls.map((url) => (
                <label
                  key={url}
                  className="flex flex-col items-center gap-1 text-[11px] text-zinc-600"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-20 w-20 rounded-md border border-zinc-200 object-cover"
                  />
                  <span className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      name="keepUrls"
                      value={url}
                      defaultChecked
                    />
                    keep
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Add reference images (upload)
          <input
            type="file"
            name="files"
            accept="image/*"
            multiple
            className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          …or import more from a product / collection URL (optional)
          <input
            name="importUrl"
            placeholder="https://acmeflorals.example/product/love-blossom"
            className={inputCls}
          />
        </label>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button type="submit" label="Save changes" variant="primary" />
            <Button href="/images/templates" label="Cancel" variant="secondary" />
          </div>
          <ConfirmSubmitButton
            formAction={deleteTemplate}
            message={`Delete “${template.name}”? This cannot be undone.`}
            label="Delete"
          />
        </div>
      </form>
    </div>
  );
}
