/**
 * Who may dispose of a proposal.
 *
 * Extracted from the server action so it can actually be exercised: the action
 * itself needs a live session, which means the rule could otherwise only be
 * verified by a human clicking a button.
 *
 * An admin can decide anything. A member can decide what came out of their own
 * work, which is the whole point of attributing proposals — putting an item on
 * someone's dashboard that they cannot action is worse than not showing it. An
 * unattributed (organisational) proposal has no member owner, so it stays with
 * admins.
 */
export function canDecideProposal(
  user: { id: string; role: string },
  proposal: { sourceUserId: string | null },
): boolean {
  if (user.role === "admin") return true;
  return proposal.sourceUserId !== null && proposal.sourceUserId === user.id;
}
