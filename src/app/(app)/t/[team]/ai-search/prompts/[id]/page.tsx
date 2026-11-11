import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Button } from "@astryxdesign/core/Button";

import { db } from "@/db";
import { aiSearchPrompts } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { PendingButton } from "@/components/ui/pending-button";
import { RunCell, inputClass, labelClass } from "@/components/ai-search/bits";
import { loadPromptRuns } from "@/lib/ai-search/data";
import { aiSearchPath, requireAiSearchTeam } from "@/lib/ai-search/gate";
import { isPlatform, LANGUAGE_LABELS, LANGUAGES, PLATFORM_LABELS, STAGE_LABELS, STAGES } from "@/lib/ai-search/model";
import { runPromptNow, updatePrompt } from "../../actions";

export const maxDuration = 300;

export default async function AiPromptPage({ params }: { params: Promise<{ team: string; id: string }> }) {
  const { team: teamSlug, id } = await params;
  const { team, brand } = await requireAiSearchTeam(teamSlug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const prompt = await db.query.aiSearchPrompts.findFirst({
    where: and(eq(aiSearchPrompts.id, id), eq(aiSearchPrompts.brandId, brand.id)),
  });
  if (!prompt) notFound();
  const runs = await loadPromptRuns(prompt.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumbs={[{ label: "AI prompts", href: aiSearchPath("/prompts") }]}
        title={prompt.text}
        description={`${STAGE_LABELS[prompt.stage as keyof typeof STAGE_LABELS] ?? prompt.stage} · ${prompt.topic} · ${LANGUAGE_LABELS[prompt.language as keyof typeof LANGUAGE_LABELS] ?? prompt.language}${prompt.active ? "" : " · paused"}`}
        action={
          prompt.active && (
            <form action={runPromptNow}>
              <input type="hidden" name="teamSlug" value={team.slug} />
              <PendingButton label="Run now" variant="primary" pending="Asking every assistant…" name="promptId" value={prompt.id} />
            </form>
          )
        }
      />

      <details className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">Edit language, stage and topic</summary>
        <form action={updatePrompt} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="teamSlug" value={team.slug} />
          <input type="hidden" name="promptId" value={prompt.id} />
          <label className={labelClass}>
            Language
            <select name="language" defaultValue={prompt.language} className={inputClass}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Stage
            <select name="stage" defaultValue={prompt.stage} className={inputClass}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Topic
            <input name="topic" defaultValue={prompt.topic} className={inputClass} />
          </label>
          <Button type="submit" label="Save" size="sm" />
        </form>
      </details>

      {runs.length === 0 ? (
        <p className="text-sm text-zinc-500">Not asked yet.</p>
      ) : (
        <div className="space-y-4">
          {runs.map((r) => (
            <article key={r.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
              <header className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-zinc-900">{isPlatform(r.platform) ? PLATFORM_LABELS[r.platform] : r.platform}</span>
                <span className="text-zinc-400">{r.runOn}</span>
                <span className="text-xs text-zinc-400">{r.model}</span>
                <RunCell run={r} />
                {r.sentiment && r.sentiment !== "neutral" && (
                  <span className={`text-xs ${r.sentiment === "positive" ? "text-emerald-700" : "text-red-700"}`}>{r.sentiment}</span>
                )}
              </header>
              {r.error ? (
                <p className="mt-2 text-sm text-red-700">{r.error}</p>
              ) : (
                <>
                  {r.accuracyIssues && r.accuracyIssues.length > 0 && (
                    <ul className="mt-2 list-disc rounded-lg bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">
                      {r.accuracyIssues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  )}
                  {r.brands.length > 0 && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Brands named, in order:{" "}
                      {r.brands.map((b, i) => (
                        <span key={i} className={r.position === i + 1 ? "font-semibold text-zinc-900" : ""}>
                          {i > 0 ? ", " : ""}
                          {b.name}
                          {b.recommended ? " (recommended)" : ""}
                        </span>
                      ))}
                    </p>
                  )}
                  {r.judgeError && <p className="mt-1 text-xs text-amber-700">Judge failed, brands not read: {r.judgeError.slice(0, 200)}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-500">Answer and {r.citations.length} sources</summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{r.answer}</div>
                    {r.citations.length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs">
                        {r.citations.map((c) => (
                          <li key={c.url} className="break-all">
                            <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-sky-700 hover:underline">
                              {c.title || c.url}
                            </a>{" "}
                            <span className="text-zinc-400">{c.domain}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
