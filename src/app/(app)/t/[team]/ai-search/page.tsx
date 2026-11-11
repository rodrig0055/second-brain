import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, Chip, Delta, Th, Tile, pct, td, tdNum } from "@/components/ai-search/bits";
import { loadFailures, loadPrompts, loadScoredRuns } from "@/lib/ai-search/data";
import { Button } from "@astryxdesign/core/Button";
import { aiSearchPath, requireAiSearchTeam } from "@/lib/ai-search/gate";
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  STAGES,
  STAGE_LABELS,
  addDaysYmd,
  isOwnDomain,
} from "@/lib/ai-search/model";
import { aiSearchToday, enabledPlatforms, loadSettings } from "@/lib/ai-search/run";
import { bilingualTopicRuns, groupBy, inWindow, summarize, topCitedDomains, topCompetitors } from "@/lib/ai-search/score";

const WINDOWS = [7, 28] as const;

export default async function AiSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { team: teamSlug } = await params;
  const { brand } = await requireAiSearchTeam(teamSlug);
  const { days: rawDays } = await searchParams;
  const days = WINDOWS.find((w) => String(w) === rawDays) ?? 7;

  const today = aiSearchToday();
  const from = addDaysYmd(today, -(days - 1));
  const prevFrom = addDaysYmd(from, -days);
  const prevTo = addDaysYmd(from, -1);

  const [settings, prompts, runs, failures] = await Promise.all([
    loadSettings(brand),
    loadPrompts(brand.id),
    loadScoredRuns(brand.id, prevFrom),
    loadFailures(brand.id, from),
  ]);
  const now = inWindow(runs, from, today);
  const prev = inWindow(runs, prevFrom, prevTo);
  const s = summarize(now);
  const p = summarize(prev);
  const ownNames = [brand.name, ...settings.aliases, ...settings.domains];
  const competitors = topCompetitors(now, ownNames);
  const domains = topCitedDomains(now, (d) => isOwnDomain(d, settings.domains));
  const platforms = enabledPlatforms(settings);
  const active = prompts.filter((x) => x.active).length;
  const bilingual = bilingualTopicRuns(now);

  const byTopic = [...groupBy(now, (r) => r.topic).entries()]
    .map(([topic, rs]) => ({
      topic,
      all: summarize(rs),
      byPlatform: Object.fromEntries(PLATFORMS.map((pl) => [pl, summarize(rs.filter((r) => r.platform === pl))])),
      leader: topCompetitors(rs, ownNames, 1)[0],
    }))
    .sort((a, b) => (b.all.visibility ?? 0) - (a.all.visibility ?? 0) || a.topic.localeCompare(b.topic));

  const header = (
    <PageHeader
      title="AI search"
      description={`How ${brand.name} shows up when Filipino shoppers ask ChatGPT, Gemini and Claude where to buy. ${active} tracked prompts, asked with each assistant's web search on. Every figure here is observed from the API answers, not modeled.`}
      action={
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <Chip key={w} href={`?days=${w}`} label={`${w} days`} active={w === days} />
          ))}
        </div>
      }
    />
  );

  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {header}
        <EmptyState
          icon={<Sparkles className="size-4" />}
          title="No answers yet"
          description={
            prompts.length === 0
              ? "Add the buyer prompts to track first."
              : "The tracker asks each due prompt every morning between 08:05 and 11:05 Manila. To see one now, open AI prompts and press Run now on a prompt."
          }
          action={
            <Button href={aiSearchPath("/prompts")} label="Open AI prompts" variant="primary" />
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      {header}

      {failures.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          Some calls failed in this window and are left out of every rate (missing, not zero):{" "}
          {failures.map((f) => `${PLATFORM_LABELS[f.platform as keyof typeof PLATFORM_LABELS] ?? f.platform} ${f.count}`).join(", ")}.{" "}
          <span className="text-amber-700">Last error: {failures[0].last.slice(0, 160)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Visibility" value={pct(s.visibility)} delta={<Delta now={s.visibility} before={p.visibility} />} hint={`Answers naming us, of ${s.answers}`} />
        <Tile label="Recommended" value={pct(s.recommendation)} delta={<Delta now={s.recommendation} before={p.recommendation} />} hint="Answers that tell the shopper to use us" />
        <Tile label="Linked citations" value={pct(s.citationRate)} delta={<Delta now={s.citationRate} before={p.citationRate} />} hint="Answers linking to one of our pages" />
        <Tile label="Mention share" value={pct(s.mentionShare)} delta={<Delta now={s.mentionShare} before={p.mentionShare} />} hint="Our mentions of all brand mentions" />
        <Tile label="Win rate" value={pct(s.winRate)} delta={<Delta now={s.winRate} before={p.winRate} />} hint={`Named first, of ${s.winBase} answers naming us and a rival`} />
        <Tile
          label="Accuracy"
          value={s.accuracyChecked ? pct(s.accuracyClean / s.accuracyChecked) : "–"}
          hint={settings.facts.trim() ? `Answers about us with no wrong facts, of ${s.accuracyChecked}` : "Not checked: add brand facts on AI prompts"}
        />
      </div>
      <p className="-mt-2 text-xs text-zinc-400">
        Change is against the {days} days before. Set no numeric targets in the first cycle: the baseline is what this period is for.
      </p>

      <Card title="By assistant" description="The same prompts, asked of each assistant.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <Th>Assistant</Th>
                <Th right>Answers</Th>
                <Th right>Visibility</Th>
                <Th right>Recommended</Th>
                <Th right>Linked</Th>
                <Th right>Mention share</Th>
                <Th right>Win rate</Th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((pl) => {
                const x = summarize(now.filter((r) => r.platform === pl));
                const y = summarize(prev.filter((r) => r.platform === pl));
                return (
                  <tr key={pl}>
                    <td className={td}>{PLATFORM_LABELS[pl]}</td>
                    <td className={tdNum}>{x.answers}</td>
                    <td className={tdNum}>
                      {pct(x.visibility)} <Delta now={x.visibility} before={y.visibility} />
                    </td>
                    <td className={tdNum}>{pct(x.recommendation)}</td>
                    <td className={tdNum}>{pct(x.citationRate)}</td>
                    <td className={tdNum}>{pct(x.mentionShare)}</td>
                    <td className={tdNum}>{pct(x.winRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="By topic"
        description="Where we show up and where we do not. A topic at zero on every assistant is a candidate to park rather than chase; a topic where a rival leads is a gap to diagnose."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                <Th>Topic</Th>
                <Th right>Answers</Th>
                {platforms.map((pl) => (
                  <Th key={pl} right>
                    {PLATFORM_LABELS[pl]}
                  </Th>
                ))}
                <Th right>Linked</Th>
                <Th>Named most instead</Th>
              </tr>
            </thead>
            <tbody>
              {byTopic.map((t) => (
                <tr key={t.topic}>
                  <td className={td}>{t.topic}</td>
                  <td className={tdNum}>{t.all.answers}</td>
                  {platforms.map((pl) => (
                    <td key={pl} className={tdNum}>
                      {pct(t.byPlatform[pl].visibility)}
                    </td>
                  ))}
                  <td className={tdNum}>{pct(t.all.citationRate)}</td>
                  <td className={`${td} text-zinc-600`}>
                    {t.leader ? `${t.leader.name} (${pct(t.leader.share)})` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {bilingual.length > 0 && (
        <Card
          title="By language"
          description={`Only topics asked in both English and Tagalog / Taglish (${[...new Set(bilingual.map((r) => r.topic))].join(", ")}), so the two rows compare the same questions. One day's answers swing; read this after a few weeks.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr>
                  <Th>Language</Th>
                  <Th right>Answers</Th>
                  {platforms.map((pl) => (
                    <Th key={pl} right>
                      {PLATFORM_LABELS[pl]}
                    </Th>
                  ))}
                  <Th right>Recommended</Th>
                </tr>
              </thead>
              <tbody>
                {LANGUAGES.map((lang) => {
                  const rs = bilingual.filter((r) => r.language === lang);
                  const x = summarize(rs);
                  return (
                    <tr key={lang}>
                      <td className={td}>{LANGUAGE_LABELS[lang]}</td>
                      <td className={tdNum}>{x.answers}</td>
                      {platforms.map((pl) => (
                        <td key={pl} className={tdNum}>
                          {pct(summarize(rs.filter((r) => r.platform === pl)).visibility)}
                        </td>
                      ))}
                      <td className={tdNum}>{pct(x.recommendation)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="By journey stage" description="Awareness asks what to buy, decision asks where.">
          <table className="w-full text-sm">
            <tbody>
              {STAGES.map((st) => {
                const x = summarize(now.filter((r) => r.stage === st));
                return (
                  <tr key={st}>
                    <td className={td}>{STAGE_LABELS[st]}</td>
                    <td className={tdNum}>{pct(x.visibility)}</td>
                    <td className={`${tdNum} text-zinc-400`}>{x.answers}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Brands named instead" description="Share of answers naming each rival.">
          {competitors.length === 0 ? (
            <p className="text-sm text-zinc-500">No other brands named.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {competitors.map((c) => (
                  <tr key={c.name}>
                    <td className={td}>{c.name}</td>
                    <td className={tdNum}>{pct(c.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Sites the assistants cite"
          description="Third-party pages behind the answers. Earning coverage here is a proven (Do) action, and has the longest lead time."
        >
          {domains.length === 0 ? (
            <p className="text-sm text-zinc-500">No citations yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {domains.map((d) => (
                  <tr key={d.domain}>
                    <td className={`${td} break-all`}>{d.domain}</td>
                    <td className={tdNum}>{d.answers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
