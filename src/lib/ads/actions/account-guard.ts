/**
 * One ad account belongs to one brand.
 *
 * Everything that decides who may change an ad runs on the brand.
 * `canDecideAdAction` checks the approver's brand grants, the alert carries a
 * brand, the audit row records a brand. The account is reached at the very end,
 * from the connection. So the chain only holds while each account is claimed by
 * exactly one brand: when two brands name the same account, a grant for either
 * one spends the other's money, and the audit trail records whichever brand the
 * approver happened to come through.
 *
 * It happens in practice: two brands sold through one ad account is common.
 *
 * A dashboard can render that as a footnote, and until now it did. A write
 * cannot, so this refuses rather than warns. It is deliberately the strict
 * version: a disconnected or errored connection still counts as a claim,
 * because marking a row disconnected does not stop it asserting that this
 * account is that brand's. The only thing that clears the gate is fixing the
 * connection.
 *
 * Pure, like `permissions.ts` and `retry.ts`, so the rule can be read and
 * tested without a database.
 */
import { normalizeAccountId } from "@/lib/integrations/meta/client";

/** One connection's assertion that an account belongs to a brand. */
export type AccountClaim = {
  brandId: string;
  brandName: string;
  adAccountId: string;
};

export type GateVerdict = { ok: boolean; reason: string };

/**
 * Whether this account is this brand's alone.
 *
 * `claims` is every Meta connection in the database, not only the live ones.
 * Both ids are normalized first: `act_123` and `123` are the same account, and
 * an invariant that a formatting difference walks through is not one.
 */
export function accountGate(
  adAccountId: string,
  brandId: string,
  claims: AccountClaim[],
): GateVerdict {
  const account = normalizeAccountId(adAccountId);
  if (!account) {
    return {
      ok: false,
      reason:
        "This connection has no ad account id, so there is nothing to write to. " +
        "Set it in Admin → Integrations.",
    };
  }

  const others = new Map<string, string>();
  for (const claim of claims) {
    if (normalizeAccountId(claim.adAccountId) !== account) continue;
    if (claim.brandId === brandId) continue;
    others.set(claim.brandId, claim.brandName);
  }

  if (others.size === 0) return { ok: true, reason: "" };

  const names = [...others.values()].sort();
  return {
    ok: false,
    reason:
      `Ad account ${account} is also claimed by ${names.join(" and ")}. ` +
      "Brand access is how changes are authorised, so while two brands name " +
      "one account a change approved for either one spends the other's " +
      "budget. Point the other connection at its own ad account in " +
      "Admin → Integrations, then try again.",
  };
}
