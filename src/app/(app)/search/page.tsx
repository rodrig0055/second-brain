import Link from "next/link";
import { requireUser } from "@/lib/access";
import { search } from "@/lib/search";
import { PageHeader } from "@/components/page-header";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const results = await search(user, q);
  const total =
    results.conversations.length + results.runs.length + results.docs.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Search"
        description="Find conversations, generated outputs, and knowledge documents."
      />

      <form action="/search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Search chats, outputs, knowledge…"
          className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
        />
      </form>

      {q && (
        <p className="mt-4 text-xs text-zinc-500">
          {total} result{total === 1 ? "" : "s"} for “{q}”
        </p>
      )}

      {results.conversations.length > 0 && (
        <Section title="Chats">
          {results.conversations.map((c) => (
            <ResultLink
              key={c.id}
              href={`/chat/${c.id}`}
              title={c.title}
              meta={new Date(c.updatedAt).toLocaleDateString("en-PH")}
            />
          ))}
        </Section>
      )}

      {results.runs.length > 0 && (
        <Section title="Task outputs">
          {results.runs.map((r) => (
            <ResultLink
              key={r.id}
              href={`/t/${r.teamSlug}/runs/${r.id}`}
              title={r.templateName}
              meta={`${r.brandName} · ${new Date(r.createdAt).toLocaleDateString("en-PH")}`}
            />
          ))}
        </Section>
      )}

      {results.docs.length > 0 && (
        <Section title="Knowledge base">
          {results.docs.map((d) => (
            <ResultLink
              key={d.id}
              href={`/admin/knowledge/${d.id}`}
              title={d.title}
              meta={d.kind}
            />
          ))}
        </Section>
      )}

      {q && total === 0 && (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white px-5 py-8 text-center">
          <p className="text-sm font-medium text-zinc-700">No matches for “{q}”</p>
          <p className="mt-1 text-xs text-zinc-500">Try a shorter phrase or a brand, team, or campaign name.</p>
        </div>
      )}

      {!q && (
        <p className="mt-6 text-sm text-zinc-500">Type a phrase to search across your accessible workspace.</p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-8">
      <p className="pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ResultLink({
  href,
  title,
  meta,
}: {
  href: string;
  title: string;
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300"
    >
      <p className="truncate text-sm text-zinc-900">{title}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{meta}</p>
    </Link>
  );
}
