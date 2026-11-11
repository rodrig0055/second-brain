/**
 * Presence metrics over stored answers. Pure: the scorecard, the cycle board
 * and the tests share it. Every rate is over answers that came back (failed
 * calls are not scored), and a rate with no answers under it is null, never 0.
 */
import { normaliseBrand, type Language, type Platform, type Stage } from "./model";

export type ScoredRun = {
  promptId: string;
  platform: Platform;
  runOn: string;
  topic: string;
  stage: Stage;
  language: Language;
  appeared: boolean;
  recommended: boolean;
  cited: boolean;
  position: number | null;
  brands: { name: string; domain: string | null; recommended: boolean }[];
  citations: { url: string; domain: string; title: string }[];
  accuracyIssues: string[] | null;
};

export type Summary = {
  answers: number;
  /** Share of answers that name us. */
  visibility: number | null;
  /** Share of answers that recommend us. */
  recommendation: number | null;
  /** Share of answers with a link to one of our pages. */
  citationRate: number | null;
  /** Our mentions over every brand mention. */
  mentionShare: number | null;
  /** Where we and a competitor are both named, how often we are named first. */
  winRate: number | null;
  winBase: number;
  /** Answers about us checked against the facts, and how many were clean. */
  accuracyChecked: number;
  accuracyClean: number;
};

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function summarize(runs: ScoredRun[]): Summary {
  let appeared = 0;
  let recommended = 0;
  let cited = 0;
  let allMentions = 0;
  let winBase = 0;
  let wins = 0;
  let checked = 0;
  let clean = 0;
  for (const r of runs) {
    if (r.appeared) appeared++;
    if (r.recommended) recommended++;
    if (r.cited) cited++;
    // The judge may miss us in its brand list when the regex caught us; count
    // us once either way.
    const others = r.brands.length - (r.position !== null ? 1 : 0);
    allMentions += Math.max(0, others) + (r.appeared ? 1 : 0);
    if (r.appeared && others > 0 && r.position !== null) {
      winBase++;
      if (r.position === 1) wins++;
    }
    if (r.accuracyIssues !== null) {
      checked++;
      if (r.accuracyIssues.length === 0) clean++;
    }
  }
  return {
    answers: runs.length,
    visibility: rate(appeared, runs.length),
    recommendation: rate(recommended, runs.length),
    citationRate: rate(cited, runs.length),
    mentionShare: rate(appeared, allMentions),
    winRate: rate(wins, winBase),
    winBase,
    accuracyChecked: checked,
    accuracyClean: clean,
  };
}

export function inWindow(runs: ScoredRun[], from: string, to: string): ScoredRun[] {
  return runs.filter((r) => r.runOn >= from && r.runOn <= to);
}

export function groupBy<K extends string>(runs: ScoredRun[], key: (r: ScoredRun) => K): Map<K, ScoredRun[]> {
  const out = new Map<K, ScoredRun[]>();
  for (const r of runs) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Brands named most often, ours excluded: who the assistants send buyers to instead. */
export function topCompetitors(
  runs: ScoredRun[],
  ownNames: string[],
  limit = 10,
): { name: string; answers: number; share: number }[] {
  const own = new Set(ownNames.map(normaliseBrand));
  const counts = new Map<string, { name: string; answers: number }>();
  for (const r of runs) {
    const seen = new Set<string>();
    for (const b of r.brands) {
      const key = normaliseBrand(b.name);
      if (!key || own.has(key) || seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key);
      if (c) c.answers++;
      else counts.set(key, { name: b.name, answers: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => ({ ...c, share: runs.length ? c.answers / runs.length : 0 }));
}

/**
 * Sites the assistants cite, ours excluded: the third-party coverage list.
 * Counted once per answer.
 */
export function topCitedDomains(
  runs: ScoredRun[],
  isOwn: (domain: string) => boolean,
  limit = 15,
): { domain: string; answers: number }[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const seen = new Set<string>();
    for (const c of r.citations) {
      if (!c.domain || isOwn(c.domain) || seen.has(c.domain)) continue;
      seen.add(c.domain);
      counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([domain, answers]) => ({ domain, answers }))
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}

/**
 * Answers in topics asked in more than one language, so a language split
 * compares the same questions rather than different topics.
 */
export function bilingualTopicRuns(runs: ScoredRun[]): ScoredRun[] {
  const langs = new Map<string, Set<Language>>();
  for (const r of runs) {
    const s = langs.get(r.topic) ?? new Set<Language>();
    s.add(r.language);
    langs.set(r.topic, s);
  }
  return runs.filter((r) => (langs.get(r.topic)?.size ?? 0) > 1);
}

/**
 * Visibility change on one topic between two windows, minus the same change
 * on the control topics (topics no action touched). Null when either side has
 * no answers, so a missing baseline never reads as a lift.
 */
export function topicLift(
  before: ScoredRun[],
  after: ScoredRun[],
  topic: string,
  controlTopics: string[],
): number | null {
  const vis = (runs: ScoredRun[], topics: Set<string>) => summarize(runs.filter((r) => topics.has(r.topic))).visibility;
  const t = new Set([topic]);
  const b = vis(before, t);
  const a = vis(after, t);
  if (b === null || a === null) return null;
  const ctrl = new Set(controlTopics.filter((c) => c !== topic));
  const cb = ctrl.size ? vis(before, ctrl) : null;
  const ca = ctrl.size ? vis(after, ctrl) : null;
  const control = cb !== null && ca !== null ? ca - cb : 0;
  return a - b - control;
}
