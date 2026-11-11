import Link from "next/link";
import { ArrowLeft, Blocks } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { requireNewsletterTeam, campaignsPath } from "@/lib/newsletter/access";
import { defsByCategory, allBlockDefs } from "@/lib/newsletter/blocks";
import { TEMPLATES } from "@/lib/newsletter/templates";
import { BlockCard } from "./block-card";

export const dynamic = "force-dynamic";

/**
 * The block catalogue.
 *
 * Every block, every design, rendered live, so an editor can see the options
 * before choosing one in a campaign. Read only: designs live in code, and the
 * registry is what this page reads, so a newly added block appears here with no
 * edit to this file.
 */
export default async function BlocksPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  await requireNewsletterTeam(teamSlug);

  const groups = defsByCategory();
  const previewBase = `/t/${teamSlug}/newsletter/blocks/preview`;
  const totalVariants = allBlockDefs().reduce((n, d) => n + d.variants.length, 0);

  const BLURB: Record<string, string> = {
    commercial: "Blocks that sell: products, collections, offers and the reassurance around them.",
    engagement: "Blocks that earn the next open. Most carry no link at all.",
    furniture: "The frame of every send. Present in all of them, never moved.",
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 lg:px-8">
      <Link href={campaignsPath()} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>

      <div className="mt-3">
        <PageHeader
          title="Blocks"
          description={`${allBlockDefs().length} blocks, ${totalVariants} designs. What each one looks like, so you know the options.`}
        />
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-700">
        <p className="flex items-start gap-2">
          <Blocks className="mt-0.5 size-4 shrink-0 text-zinc-500" />
          <span>
            A block is one section of an email. Each has designs that share the same
            content, so switching design never loses copy. Which blocks appear in a
            campaign is decided by the content framework for that brand and weekday;
            the {TEMPLATES.length} templates decide the shape around them.
          </span>
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.category} className="mt-9">
          <h2 className="text-base font-semibold text-zinc-900">{g.label}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{BLURB[g.category] ?? ""}</p>
          <div className="mt-4 space-y-5">
            {g.defs.map((d) => (
              <BlockCard
                key={d.kind}
                previewBase={previewBase}
                kind={d.kind}
                label={d.label}
                category={g.label}
                blurb={d.blurb}
                variants={d.variants.map((v) => ({ id: v.id, label: v.label, blurb: v.blurb }))}
                fields={d.fields.map((f) => ({ name: f.name, label: f.label, kind: f.kind, hint: f.hint }))}
                items={d.items ? { label: d.items.label, max: d.items.max ?? 12 } : null}
                productSlots={d.productSlots ?? null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
