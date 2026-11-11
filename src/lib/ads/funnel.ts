/**
 * Deciding which funnel stage a campaign, ad set or ad belongs to.
 *
 * The process doc says funnel is read off the campaign name, then immediately
 * lists the exceptions: SG keeps MOF and BOF in one campaign separated by ad
 * set name, and Bloomly PH runs its MOF ad set ("A - Engaged 60D") inside the
 * TOF campaign. So for the first account we are automating, the documented
 * rule gives the wrong answer, and it does so silently — MOF spend filed under
 * TOF still adds up, still renders, and quietly moves both funnels' numbers.
 *
 * Hence two rules here:
 *
 * The narrowest annotation wins. A human statement about this exact ad set
 * beats any inference from the campaign containing it.
 *
 * A guess is never returned as a fact. Anything derived from a name carries
 * `needsReview`, and an entity nothing matches comes back `null` rather than
 * defaulting to TOF. A default would be indistinguishable from knowledge.
 */

export const FUNNELS = ["TOF", "MOF", "BOF"] as const;
export type Funnel = (typeof FUNNELS)[number];

export function isFunnel(value: unknown): value is Funnel {
  return typeof value === "string" && (FUNNELS as readonly string[]).includes(value);
}

/** A human's statement about one entity. */
export type FunnelAnnotation = {
  funnel: Funnel;
  /** e.g. "A - Engaged 60D". Free text from the audiences tab. */
  audienceLabel?: string;
  /**
   * An ad set created so a sale's ads actually spend. The doc: dropping event
   * ads into a working BAU ad set means Meta keeps spending on the proven ads
   * and the new ones get nothing. These are judged against their own targets.
   */
  isEventAdSet?: boolean;
};

/** Annotations by level, keyed by Meta entity id. */
export type FunnelAnnotations = {
  ad?: Record<string, FunnelAnnotation>;
  adset?: Record<string, FunnelAnnotation>;
  campaign?: Record<string, FunnelAnnotation>;
};

/** The entity being resolved, with whatever ancestry the row carried. */
export type FunnelSubject = {
  adId?: string;
  adName?: string;
  adSetId?: string;
  adSetName?: string;
  campaignId?: string;
  campaignName?: string;
};

export type FunnelSource =
  | "ad"
  | "adset"
  | "campaign"
  | "adset-name"
  | "campaign-name"
  | "unmapped";

export type FunnelResolution = {
  funnel: Funnel | null;
  source: FunnelSource;
  /** True unless a human said so at some level. Drives the review prompt. */
  needsReview: boolean;
  /** Present when an annotation supplied one. */
  audienceLabel?: string;
  isEventAdSet: boolean;
  /** Why it resolved this way, for the cockpit and the alert text. */
  explanation: string;
};

/**
 * Funnel tokens in a name.
 *
 * Deliberately only the three explicit abbreviations, with word boundaries.
 * Looser matching was tempting, but "retargeting" maps to MOF in some accounts
 * and BOF in others, and a wrong confident answer is worse here than no answer:
 * the whole point of this module is that the cheap inference is what misfiled
 * Bloomly PH's MOF spend in the first place.
 */
const NAME_PATTERNS: [RegExp, Funnel][] = [
  [/\bTOF\b/i, "TOF"],
  [/\bMOF\b/i, "MOF"],
  [/\bBOF\b/i, "BOF"],
];

function fromName(name: string | undefined): Funnel | null {
  if (!name) return null;
  const hits = NAME_PATTERNS.filter(([pattern]) => pattern.test(name));
  // "TOF to MOF test" names two stages and means neither reliably.
  if (hits.length !== 1) return null;
  return hits[0][1];
}

/**
 * Resolve one entity's funnel.
 *
 * Order: the entity's own annotation, then its ad set's, then its campaign's,
 * then the ad set name, then the campaign name, then nothing.
 */
export function resolveFunnel(
  subject: FunnelSubject,
  annotations: FunnelAnnotations = {},
): FunnelResolution {
  const annotated = (
    level: "ad" | "adset" | "campaign",
    id: string | undefined,
  ): (FunnelAnnotation & { level: typeof level }) | null => {
    if (!id) return null;
    const hit = annotations[level]?.[id];
    return hit ? { ...hit, level } : null;
  };

  const own =
    annotated("ad", subject.adId) ??
    annotated("adset", subject.adSetId) ??
    annotated("campaign", subject.campaignId);

  // An event ad set marks every ad inside it, so look for that flag on the ad
  // set even when the funnel itself was settled at another level.
  const adSetAnnotation = annotations.adset?.[subject.adSetId ?? ""];
  const isEventAdSet = Boolean(own?.isEventAdSet ?? adSetAnnotation?.isEventAdSet);

  if (own) {
    const where =
      own.level === "ad"
        ? "this ad"
        : own.level === "adset"
          ? "its ad set"
          : "its campaign";
    return {
      funnel: own.funnel,
      source: own.level,
      needsReview: false,
      audienceLabel: own.audienceLabel,
      isEventAdSet,
      explanation: `Set on ${where}.`,
    };
  }

  const fromAdSetName = fromName(subject.adSetName);
  if (fromAdSetName) {
    return {
      funnel: fromAdSetName,
      source: "adset-name",
      needsReview: true,
      isEventAdSet,
      explanation:
        `Guessed from the ad set name "${subject.adSetName}". Confirm it.`,
    };
  }

  const fromCampaignName = fromName(subject.campaignName);
  if (fromCampaignName) {
    return {
      funnel: fromCampaignName,
      source: "campaign-name",
      needsReview: true,
      isEventAdSet,
      explanation:
        `Guessed from the campaign name "${subject.campaignName}". This is the ` +
        "least reliable signal: Bloomly PH keeps a MOF ad set inside its TOF " +
        "campaign, so confirm it against the ad set.",
    };
  }

  return {
    funnel: null,
    source: "unmapped",
    needsReview: true,
    isEventAdSet,
    explanation:
      "Nothing says which funnel this belongs to. Set it on the ad set so its " +
      "spend stops sitting outside every funnel total.",
  };
}

/**
 * Ad sets carrying spend that no funnel claims.
 *
 * Worth surfacing on its own: an unmapped ad set does not break a total, it
 * quietly shrinks one, and the gap only shows when funnel figures are compared
 * against the account total.
 */
export function unmappedAdSets<T extends FunnelSubject & { spend: number }>(
  rows: T[],
  annotations: FunnelAnnotations = {},
): { adSetId: string; adSetName: string; spend: number }[] {
  const out = new Map<string, { adSetId: string; adSetName: string; spend: number }>();
  for (const row of rows) {
    if (!row.adSetId) continue;
    if (resolveFunnel(row, annotations).funnel) continue;
    const existing = out.get(row.adSetId);
    if (existing) {
      existing.spend += row.spend;
    } else {
      out.set(row.adSetId, {
        adSetId: row.adSetId,
        adSetName: row.adSetName ?? row.adSetId,
        spend: row.spend,
      });
    }
  }
  return [...out.values()].sort((a, b) => b.spend - a.spend);
}
