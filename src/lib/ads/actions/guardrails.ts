/**
 * The limits that make approving a change set a reasonable thing to ask.
 *
 * Propose-only already means nothing happens unattended. These cover the other
 * failure, which is likelier: somebody saying yes to something bigger than they
 * realised, at the end of a day, from a phone.
 *
 * A breach refuses the whole set rather than trimming it. Applying the half
 * that fits produces an account state nobody chose, and nobody would be able to
 * say afterwards which half it was.
 *
 * Pure, so the numbers can be argued about without reading a query. The numbers
 * themselves belong to the specialist, not to engineering, and carry the same
 * `confirmed` flag the kill rules use: an unconfirmed limit still applies but
 * says everywhere that nobody has agreed to it.
 */

export type Guardrails = {
  /** Share of trailing daily spend this set may move, as a percentage. */
  dailyDeltaPct: number;
  /** Largest change to one entity's budget, as a percentage of its current. */
  maxEntityChangePct: number;
  /** Entities in one set. A set nobody can read is a set nobody can judge. */
  maxEntities: number;
  /** Hours an entity is left alone after somebody last changed it. */
  cooldownHours: number;
  /** Whether a person has agreed these numbers for this brand. */
  confirmed: boolean;
};

/** Acme Florals PH's working numbers, pending the specialist's own. */
export const DEFAULT_GUARDRAILS: Guardrails = {
  dailyDeltaPct: 20,
  maxEntityChangePct: 50,
  maxEntities: 20,
  cooldownHours: 12,
  confirmed: false,
};

export type ProposedChange = {
  kind: "set_budget" | "set_schedule" | "set_status";
  level: "campaign" | "adset" | "ad";
  entityId: string;
  entityName: string;
  /** Minor units, for a budget change. Null for anything else. */
  beforeMinor?: string | null;
  afterMinor?: string | null;
  /** When this entity was last changed from here, for the cooldown. */
  lastChangedAt?: Date | null;
};

export type GuardrailContext = {
  /** Mean daily spend over the trailing window, in MAJOR units. */
  trailingDailySpend: number;
  currency: string;
  /** Minor units per major unit, so budgets and spend can be compared. */
  minorPerMajor: number;
  now?: Date;
};

export type GuardrailVerdict = {
  ok: boolean;
  /** Every breach, not the first: a person fixing a set wants the whole list. */
  breaches: string[];
  /** What this set would add to or remove from daily spend, in major units. */
  netDailyDelta: number;
};

function majors(minor: string | null | undefined, per: number): number {
  if (minor === null || minor === undefined || minor === "") return 0;
  const n = Number(minor);
  return Number.isFinite(n) ? n / per : 0;
}

/**
 * Whether this set is within the limits.
 *
 * The daily-delta check is the one that matters, and it is deliberately net:
 * moving money between ad sets is the common case and should not be counted as
 * spending twice. Cutting one by 50 and raising another by 50 is a net zero and
 * passes, which is the whole point of being able to propose both at once.
 */
export function checkGuardrails(
  changes: ProposedChange[],
  rails: Guardrails,
  ctx: GuardrailContext,
): GuardrailVerdict {
  const breaches: string[] = [];
  const now = ctx.now ?? new Date();
  const per = ctx.minorPerMajor;

  if (changes.length === 0) {
    return { ok: false, breaches: ["A change set has to change something."], netDailyDelta: 0 };
  }

  if (changes.length > rails.maxEntities) {
    breaches.push(
      `${changes.length} entities in one set, over the limit of ${rails.maxEntities}. ` +
        "Split it into sets somebody can actually read.",
    );
  }

  let netDailyDelta = 0;
  for (const change of changes) {
    if (change.kind === "set_budget") {
      const before = majors(change.beforeMinor, per);
      const after = majors(change.afterMinor, per);
      netDailyDelta += after - before;

      // A percentage of zero is not a percentage, so a budget starting from
      // nothing is judged by the daily cap alone rather than by a ratio that
      // would always be infinite.
      if (before > 0) {
        const movePct = (Math.abs(after - before) / before) * 100;
        if (movePct > rails.maxEntityChangePct) {
          breaches.push(
            `${change.entityName}: ${movePct.toFixed(0)}% change, over the ` +
              `${rails.maxEntityChangePct}% per-entity limit ` +
              `(${before.toFixed(2)} to ${after.toFixed(2)} ${ctx.currency}).`,
          );
        }
      }
    }

    if (rails.cooldownHours > 0 && change.lastChangedAt) {
      const hours = (now.getTime() - change.lastChangedAt.getTime()) / 3_600_000;
      if (hours < rails.cooldownHours) {
        breaches.push(
          `${change.entityName} was changed ${hours.toFixed(1)}h ago, inside ` +
            `the ${rails.cooldownHours}h cooldown. Somebody may have just ` +
            "decided something here.",
        );
      }
    }
  }

  // Only an increase is capped. Spending less than yesterday is not the risk
  // this limit exists for, and a rule that blocked cuts would block exactly the
  // proposals the kill rules produce.
  if (netDailyDelta > 0) {
    const allowed = (ctx.trailingDailySpend * rails.dailyDeltaPct) / 100;
    if (ctx.trailingDailySpend <= 0) {
      breaches.push(
        "There is no trailing spend to measure this against, so an increase " +
          "cannot be judged. Approve it by hand or wait for a week of data.",
      );
    } else if (netDailyDelta > allowed) {
      breaches.push(
        `This set raises daily spend by ${netDailyDelta.toFixed(2)} ${ctx.currency}, ` +
          `over the ${rails.dailyDeltaPct}% limit of ${allowed.toFixed(2)} ` +
          `(trailing daily spend ${ctx.trailingDailySpend.toFixed(2)}).`,
      );
    }
  }

  return { ok: breaches.length === 0, breaches, netDailyDelta };
}

/** A one-line summary for the approver, above the detail. */
export function describeImpact(
  verdict: GuardrailVerdict,
  ctx: GuardrailContext,
): string {
  const d = verdict.netDailyDelta;
  if (Math.abs(d) < 0.005) return "No net change to daily spend.";
  const direction = d > 0 ? "raises" : "cuts";
  return `${direction} daily spend by ${Math.abs(d).toFixed(2)} ${ctx.currency}.`;
}
