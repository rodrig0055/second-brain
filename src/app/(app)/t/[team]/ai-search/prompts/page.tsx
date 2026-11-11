import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ActionSheet } from "@/components/ui/action-sheet";
import { PendingButton } from "@/components/ui/pending-button";
import { RunCell, Th, inputClass, labelClass, td } from "@/components/ai-search/bits";
import { loadLatestRuns, loadPrompts } from "@/lib/ai-search/data";
import { aiSearchPath, requireAiSearchTeam } from "@/lib/ai-search/gate";
import { LANGUAGES, LANGUAGE_LABELS, PLATFORMS, PLATFORM_LABELS, STAGES, STAGE_LABELS, addDaysYmd } from "@/lib/ai-search/model";
import { aiSearchToday, enabledPlatforms, loadSettings } from "@/lib/ai-search/run";
import { addPrompts, runPromptNow, saveSettings, togglePrompt } from "../actions";

// Run now asks every assistant with web search on; Claude can take a minute.
export const maxDuration = 300;

export default async function AiPromptsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team: teamSlug } = await params;
  const { team, brand } = await requireAiSearchTeam(teamSlug);
  const today = aiSearchToday();
  const [settings, prompts, latest] = await Promise.all([
    loadSettings(brand),
    loadPrompts(brand.id),
    loadLatestRuns(brand.id, addDaysYmd(today, -30)),
  ]);
  const platforms = enabledPlatforms(settings);
  const topics = [...new Set(prompts.map((p) => p.topic))].sort();

  const addForm = (
    <ActionSheet
      label="Add prompts"
      title="Add buyer prompts"
      description="Write them the way a shopper types into ChatGPT: a real question, with the place in it. 30 to 50 in all is the right size to track."
    >
      <form action={addPrompts} className="grid gap-3">
        <input type="hidden" name="teamSlug" value={team.slug} />
        <label className={labelClass}>
          Prompts, one per line
          <textarea name="text" required rows={6} className={inputClass} placeholder="Where can I order same-day flower delivery in Quezon City?" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Language
            <select name="language" defaultValue="en" className={inputClass}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Stage
            <select name="stage" defaultValue="decision" className={inputClass}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Topic
            <input name="topic" required list="ai-topics" className={inputClass} placeholder="same-day delivery" />
            <datalist id="ai-topics">
              {topics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
        </div>
        <Button type="submit" label="Add" variant="primary" size="sm" />
      </form>
    </ActionSheet>
  );

  const settingsForm = (
    <ActionSheet label="Settings" title="Tracker settings" variant="secondary" icon={<Settings2 className="size-4" />}>
      <form action={saveSettings} className="grid gap-4">
        <input type="hidden" name="teamSlug" value={team.slug} />
        <label className={labelClass}>
          Names that mean us, one per line
          <textarea name="aliases" rows={3} defaultValue={settings.aliases.join("\n")} className={inputClass} />
          <span className="text-zinc-400">Matched as whole words. Never add &quot;flower store&quot;: every answer says it.</span>
        </label>
        <label className={labelClass}>
          Our domains
          <textarea name="domains" rows={2} defaultValue={settings.domains.join("\n")} className={inputClass} />
        </label>
        <label className={labelClass}>
          Brand facts
          <textarea
            name="facts"
            rows={8}
            defaultValue={settings.facts}
            className={inputClass}
            placeholder={"Delivery areas, same-day cutoff, price range, payment options, international sending..."}
          />
          <span className="text-zinc-400">
            Each answer that names us is checked against these. Leave empty and accuracy is not scored. Only write what is true today.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Ask each prompt every
            <select name="cadenceDays" defaultValue={String(settings.cadenceDays)} className={inputClass}>
              <option value="1">day (baseline: first 4 weeks)</option>
              <option value="7">week (after the baseline)</option>
            </select>
          </label>
          <fieldset className={labelClass}>
            Assistants
            <div className="flex flex-wrap gap-3 pt-1">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm text-zinc-700">
                  <input type="checkbox" name={`platform_${p}`} defaultChecked={platforms.includes(p)} />
                  {PLATFORM_LABELS[p]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <Button type="submit" label="Save" variant="primary" size="sm" />
      </form>
    </ActionSheet>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="AI prompts"
        description={`The buyer questions we ask ${platforms.map((p) => PLATFORM_LABELS[p]).join(", ")} ${settings.cadenceDays === 1 ? "every day" : `every ${settings.cadenceDays} days`}. Each cell is the latest answer: named or recommended (with our rank among the brands named), and whether it linked to us.`}
        action={
          <>
            {settingsForm}
            {addForm}
          </>
        }
      />

      {!settings.facts.trim() && prompts.length > 0 && (
        <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-600">
          Accuracy is not being checked yet: add the brand facts under Settings.
        </p>
      )}

      {prompts.length === 0 ? (
        <EmptyState title="No prompts yet" description="Add 30 to 50 buyer questions, tagged by stage and topic." action={addForm} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <Th>Prompt</Th>
                <Th>Topic</Th>
                {platforms.map((p) => (
                  <Th key={p}>{PLATFORM_LABELS[p]}</Th>
                ))}
                <Th />
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className={`${td} max-w-md`}>
                    <Link href={aiSearchPath(`/prompts/${p.id}`)} className="text-zinc-900 hover:underline">
                      {p.text}
                    </Link>
                    <span className="mt-0.5 block text-xs text-zinc-400">{STAGE_LABELS[p.stage as keyof typeof STAGE_LABELS] ?? p.stage}
                      {p.language !== "en" && ` · ${LANGUAGE_LABELS[p.language as keyof typeof LANGUAGE_LABELS] ?? p.language}`}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-zinc-600`}>{p.topic}</td>
                  {platforms.map((pl) => (
                    <td key={pl} className={td}>
                      <RunCell run={latest.get(`${p.id}:${pl}`)} />
                    </td>
                  ))}
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <div className="inline-flex gap-1.5">
                      {p.active && (
                        <form action={runPromptNow}>
                          <input type="hidden" name="teamSlug" value={team.slug} />
                          <input type="hidden" name="promptId" value={p.id} />
                          <PendingButton label="Run now" size="sm" pending="Asking…" name="promptId" value={p.id} />
                        </form>
                      )}
                      <form action={togglePrompt}>
                        <input type="hidden" name="teamSlug" value={team.slug} />
                        <input type="hidden" name="promptId" value={p.id} />
                        <Button type="submit" label={p.active ? "Pause" : "Resume"} size="sm" />
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
