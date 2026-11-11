import Link from "next/link";
import { planningCaption } from "@/lib/image-settings";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { imageGenerations } from "@/db/schema";
import { requireUser } from "@/lib/access";
import { imageModelLabel } from "@/lib/image-models";
import { platformLabel } from "@/lib/platforms";
import { ImageDownloadLinks } from "@/components/image-download-links";

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const gen = await db.query.imageGenerations.findFirst({
    where: eq(imageGenerations.id, id),
    with: { brand: true },
  });
  if (!gen || (gen.userId !== user.id && user.role !== "admin")) notFound();

  const platforms = [...new Set(gen.outputs.map((o) => o.platform))];

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <Link href="/images" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Image Studio
      </Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{gen.brief}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {gen.brand.name} · {gen.models.map(imageModelLabel).join(", ")} ·{" "}
        {new Date(gen.createdAt).toLocaleString("en-PH")}
      </p>

      {gen.referenceUrls.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            References
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {gen.referenceUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt="reference"
                className="h-16 w-16 rounded-md border border-zinc-200 object-cover"
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 space-y-8">
        {platforms.map((p) => (
          <div key={p}>
            <h3 className="mb-2 text-sm font-medium text-zinc-700">
              {platformLabel(p)}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {gen.outputs
                .filter((o) => o.platform === p)
                .map((o) => (
                  <figure
                    key={`${o.model}-${o.platform}-${o.variant ?? 1}`}
                    className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.url} alt={imageModelLabel(o.model)} className="w-full" />
                    <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-zinc-600">
                      <span>
                        {imageModelLabel(o.model)}
                        {o.variant ? ` · v${o.variant}` : ""}
                        {planningCaption(o.settings)}
                      </span>
                      <ImageDownloadLinks
                        url={o.url}
                        name={`${gen.brand.name} ${platformLabel(p)} ${imageModelLabel(o.model)} v${o.variant ?? 1}`}
                      />
                    </figcaption>
                  </figure>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
