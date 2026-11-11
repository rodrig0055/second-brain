/**
 * Reading change sets back for the person who has to decide on them.
 *
 * The approver's question is not "what fields will be written" but "what will
 * this do to the account, and can I see enough to say yes". So every action
 * carries its before and its after, the set carries what it does to daily
 * spend, and anything that cannot be shown plainly is left out rather than
 * rendered as a field name somebody has to decode.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adActions, adChangeSets, brands, users } from "@/db/schema";
import { fromMinorUnits } from "@/lib/integrations/meta/entities";
import {
  DEFAULT_GUARDRAILS,
  describeImpact,
  type GuardrailContext,
  type Guardrails,
} from "@/lib/ads/actions/guardrails";

export type ChangeRow = {
  id: string;
  kind: string;
  level: string;
  entityId: string;
  entityName: string;
  state: string;
  /** Human-readable "5 USD/day" style, or null where there is nothing to show. */
  before: string | null;
  after: string | null;
  /** Set when this change reaches further than the entity it names. */
  caveat: string | null;
  error: string | null;
};

export type ChangeSetView = {
  id: string;
  brandId: string;
  brandName: string;
  reason: string;
  expectation: string;
  source: string;
  state: string;
  decision: string;
  proposedBy: string | null;
  decidedBy: string | null;
  createdAt: string;
  currency: string;
  guardrails: Guardrails;
  /** One line: what this does to daily spend. */
  impact: string;
  changes: ChangeRow[];
};

function money(minor: string | null | undefined, currency: string): string | null {
  const value = fromMinorUnits(minor ?? null, currency);
  if (value === null || value === 0) return null;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

/** What an action changes, in the words the approver reads. */
function describe(
  action: typeof adActions.$inferSelect,
  currency: string,
): { before: string | null; after: string | null; caveat: string | null } {
  const payload = (action.payload ?? {}) as {
    fields?: Record<string, string | number>;
    beforeMinor?: string | null;
    afterMinor?: string | null;
    expectedStatus?: string;
    caveat?: string;
    resource?: string;
  };
  const caveat = payload.caveat ?? null;

  if (action.kind === "set_budget") {
    return {
      before: money(payload.beforeMinor, currency),
      after: money(payload.afterMinor, currency),
      caveat,
    };
  }
  if (action.kind === "set_status") {
    const wanted = String(payload.fields?.status ?? "");
    return { before: payload.expectedStatus ?? null, after: wanted || null, caveat };
  }
  if (action.kind === "set_schedule") {
    const fields = payload.fields ?? {};
    const after = Object.entries(fields)
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
      .join(", ");
    return { before: null, after: after || null, caveat };
  }
  if (action.kind === "pause_ad") return { before: "ACTIVE", after: "PAUSED", caveat };
  if (action.kind === "activate_ad") return { before: "PAUSED", after: "ACTIVE", caveat };
  return { before: null, after: null, caveat };
}

export async function loadChangeSets(options: {
  brandIds: string[];
  states?: string[];
  limit?: number;
}): Promise<ChangeSetView[]> {
  if (options.brandIds.length === 0) return [];

  const sets = await db
    .select({
      set: adChangeSets,
      brandName: brands.name,
    })
    .from(adChangeSets)
    .innerJoin(brands, eq(brands.id, adChangeSets.brandId))
    .where(
      options.states?.length
        ? and(
            inArray(adChangeSets.brandId, options.brandIds),
            inArray(adChangeSets.state, options.states),
          )
        : inArray(adChangeSets.brandId, options.brandIds),
    )
    .orderBy(desc(adChangeSets.createdAt))
    .limit(options.limit ?? 50);

  if (sets.length === 0) return [];

  const setIds = sets.map((r) => r.set.id);
  const actions = await db
    .select()
    .from(adActions)
    .where(inArray(adActions.changeSetId, setIds));

  const peopleIds = [
    ...new Set(
      sets.flatMap((r) => [r.set.proposedById, r.set.decidedById]).filter(Boolean),
    ),
  ] as string[];
  const people = peopleIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, peopleIds))
    : [];
  const nameOf = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.name ?? people.find((p) => p.id === id)?.email ?? null) : null;

  return sets.map(({ set, brandName }) => {
    const rails = { ...DEFAULT_GUARDRAILS, ...(set.guardrails as Partial<Guardrails>) };
    const currency = String(
      (set.guardrails as { currency?: string })?.currency ?? "USD",
    );
    const mine = actions.filter((a) => a.changeSetId === set.id);

    // Recomputed from what is stored rather than trusted from proposal time:
    // the figure an approver reads should be derived from the same rows the
    // table below it shows.
    const ctx: GuardrailContext = {
      trailingDailySpend: Number(
        (set.guardrails as { trailingDailySpend?: number })?.trailingDailySpend ?? 0,
      ),
      currency,
      minorPerMajor: fromMinorUnits("100", currency) === 1 ? 100 : 1,
    };
    const net = mine.reduce((sum, a) => {
      const p = (a.payload ?? {}) as { beforeMinor?: string; afterMinor?: string };
      if (a.kind !== "set_budget") return sum;
      const before = fromMinorUnits(p.beforeMinor ?? null, currency) ?? 0;
      const after = fromMinorUnits(p.afterMinor ?? null, currency) ?? 0;
      return sum + (after - before);
    }, 0);

    return {
      id: set.id,
      brandId: set.brandId,
      brandName,
      reason: set.reason,
      expectation: set.expectation,
      source: set.source,
      state: set.state,
      decision: set.decision,
      proposedBy: nameOf(set.proposedById),
      decidedBy: nameOf(set.decidedById),
      createdAt: set.createdAt.toISOString(),
      currency,
      guardrails: rails,
      impact: describeImpact({ ok: true, breaches: [], netDailyDelta: net }, ctx),
      changes: mine.map((a) => ({
        id: a.id,
        kind: a.kind,
        level: a.level,
        entityId: a.entityId,
        entityName: a.entityName,
        state: a.state,
        error: a.error,
        ...describe(a, currency),
      })),
    };
  });
}
