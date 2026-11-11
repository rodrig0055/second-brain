/**
 * Which entity a budget change has to be written to.
 *
 * Not a formality. The first real sync of Bloomly PH found the account is
 * mixed: 26 of 42 campaigns carry a budget and so do 175 of 234 ad sets. Under
 * campaign budget optimisation the money sits on the campaign and the ad set
 * has none; without it, the reverse. Both shapes are live in the same account.
 *
 * So a proposal cannot pick a level and stay there. Writing a daily budget to
 * an ad set whose campaign holds the money is not an error Meta reports in a
 * way anyone would notice: it is accepted, and it changes nothing that spends.
 * The change has to be aimed at whichever entity actually holds the budget,
 * and if neither does, refused rather than guessed.
 */

export type BudgetHolder = {
  level: "campaign" | "adset";
  entityId: string;
  entityName: string;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
};

export type BudgetTarget =
  | {
      ok: true;
      level: "campaign" | "adset";
      entityId: string;
      entityName: string;
      /** Which field the money is in, and so which one may be changed. */
      field: "daily_budget" | "lifetime_budget";
      currentMinor: string;
    }
  | { ok: false; reason: string };

function has(value: string | null): value is string {
  return value !== null && value !== "" && value !== "0";
}

/**
 * Where to write a budget change aimed at this ad set.
 *
 * `campaign` is the ad set's parent, which the caller has already loaded from
 * the mirror. Passing null says the parent is unknown, which is different from
 * the parent having no budget, and is refused rather than assumed either way.
 */
export function resolveBudgetTarget(
  adset: BudgetHolder,
  campaign: BudgetHolder | null,
): BudgetTarget {
  const adsetDaily = has(adset.dailyBudgetMinor);
  const adsetLifetime = has(adset.lifetimeBudgetMinor);

  if (adsetDaily || adsetLifetime) {
    // The ad set holds its own money. Under Meta's rules its campaign then
    // cannot also hold a budget, so there is nothing to disambiguate.
    return {
      ok: true,
      level: "adset",
      entityId: adset.entityId,
      entityName: adset.entityName,
      field: adsetDaily ? "daily_budget" : "lifetime_budget",
      currentMinor: (adsetDaily
        ? adset.dailyBudgetMinor
        : adset.lifetimeBudgetMinor) as string,
    };
  }

  if (!campaign) {
    return {
      ok: false,
      reason:
        `Ad set ${adset.entityName} carries no budget, so its campaign holds ` +
        "it, and that campaign is not in the mirror yet. Run a sync before " +
        "proposing a budget change here.",
    };
  }

  const campDaily = has(campaign.dailyBudgetMinor);
  const campLifetime = has(campaign.lifetimeBudgetMinor);
  if (campDaily || campLifetime) {
    return {
      ok: true,
      level: "campaign",
      entityId: campaign.entityId,
      entityName: campaign.entityName,
      field: campDaily ? "daily_budget" : "lifetime_budget",
      currentMinor: (campDaily
        ? campaign.dailyBudgetMinor
        : campaign.lifetimeBudgetMinor) as string,
    };
  }

  return {
    ok: false,
    reason:
      `Neither ad set ${adset.entityName} nor campaign ${campaign.entityName} ` +
      "carries a budget. Something else is controlling spend here, so a budget " +
      "change would be written somewhere it does nothing.",
  };
}

/**
 * Whether changing this budget would also move another ad set's money.
 *
 * A campaign budget is shared by every ad set under it. "Cut this ad set to
 * half" aimed at a campaign-level budget cuts all of them, which is usually
 * not what the sentence meant. The caller is told so it can say so.
 */
export function affectsSiblings(
  target: BudgetTarget,
  siblingCount: number,
): string | null {
  if (!target.ok || target.level !== "campaign") return null;
  if (siblingCount <= 1) return null;
  return (
    `This budget sits on the campaign and is shared by ${siblingCount} ad ` +
    "sets, so changing it changes all of them, not only the one this was " +
    "proposed for."
  );
}
