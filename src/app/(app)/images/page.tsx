import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { brandAssets, imageGenerations, imageTemplates } from "@/db/schema";
import { getUserBrands, requireUser } from "@/lib/access";
import { ImageStudio } from "@/components/image-studio";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

export default async function ImageStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const user = await requireUser();
  const { template: templateId } = await searchParams;
  const [allBrands, assets, recent, template] = await Promise.all([
    getUserBrands(user),
    db.query.brandAssets.findMany({ orderBy: [desc(brandAssets.createdAt)] }),
    db.query.imageGenerations.findMany({
      where: eq(imageGenerations.userId, user.id),
      orderBy: [desc(imageGenerations.createdAt)],
      limit: 8,
      with: { brand: true },
    }),
    templateId
      ? db.query.imageTemplates.findFirst({
          where: eq(imageTemplates.id, templateId),
        })
      : Promise.resolve(undefined),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Image Studio"
        description="Generate brand-grounded creative across formats and models."
      />

      <ImageStudio
        brands={allBrands}
        assets={assets}
        initialBrief={template?.prompt}
        initialReferenceUrls={template?.referenceUrls}
        initialBrandId={template?.brandId ?? undefined}
        templateId={template?.id}
      />

      {recent.length > 0 && (
        <section className="mt-14">
          <h2 className="text-sm font-medium text-zinc-700">Recent generations</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recent.map((g) => (
              <Link
                key={g.id}
                href={`/images/${g.id}`}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-900">{g.brief}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {g.brand.name} · {g.outputs.length} image
                    {g.outputs.length === 1 ? "" : "s"} ·{" "}
                    {new Date(g.createdAt).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <StatusBadge status={g.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
