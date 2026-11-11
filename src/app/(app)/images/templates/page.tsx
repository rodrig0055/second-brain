import { and, asc, count, desc, eq, isNotNull, max } from "drizzle-orm";
import { db } from "@/db";
import { imageGenerations, imageTemplateFolders, imageTemplates } from "@/db/schema";
import { getUserBrands, requireUser } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { TemplateLibrary, type LibraryTemplate } from "./template-library";

export default async function ImageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const [params, templates, folders, brands, totals, mine] = await Promise.all([
    searchParams,
    db.query.imageTemplates.findMany({
      orderBy: [desc(imageTemplates.createdAt)],
      with: {
        brand: { columns: { name: true } },
        createdBy: { columns: { name: true, email: true } },
      },
    }),
    db.query.imageTemplateFolders.findMany({
      orderBy: [asc(imageTemplateFolders.name)],
    }),
    getUserBrands(user),
    // Runs per template, everyone. Only runs since template tracking began carry a templateId.
    db
      .select({ templateId: imageGenerations.templateId, uses: count() })
      .from(imageGenerations)
      .where(isNotNull(imageGenerations.templateId))
      .groupBy(imageGenerations.templateId),
    // This user's own runs per template, for "Recently used" and the per-user ranking.
    db
      .select({
        templateId: imageGenerations.templateId,
        uses: count(),
        lastUsed: max(imageGenerations.createdAt),
      })
      .from(imageGenerations)
      .where(
        and(eq(imageGenerations.userId, user.id), isNotNull(imageGenerations.templateId)),
      )
      .groupBy(imageGenerations.templateId),
  ]);

  const usesById = new Map(totals.map((r) => [r.templateId, r.uses]));
  const mineById = new Map(mine.map((r) => [r.templateId, r]));

  const library: LibraryTemplate[] = templates.map((t) => {
    const own = mineById.get(t.id);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      referenceUrls: t.referenceUrls,
      brandId: t.brandId,
      brandName: t.brand?.name ?? null,
      folderId: t.folderId,
      createdById: t.createdById,
      createdByName: t.createdBy?.name || t.createdBy?.email.split("@")[0] || null,
      createdAt: t.createdAt.toISOString(),
      uses: usesById.get(t.id) ?? 0,
      myUses: own?.uses ?? 0,
      myLastUsed: own?.lastUsed ? new Date(own.lastUsed).toISOString() : null,
    };
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Image templates"
        description="Save a reference look and prompt, then reuse it for consistent on-brand creative."
      />

      <TemplateLibrary
        templates={library}
        folders={folders.map((f) => ({ id: f.id, name: f.name }))}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        currentUserId={user.id}
        initial={{
          q: params.q ?? "",
          folder: params.folder ?? "",
          brand: params.brand ?? "",
          type: params.type ?? "",
          mine: params.mine === "1",
          sort: params.sort ?? "",
        }}
      />
    </div>
  );
}
