/**
 * The follow-up ladder: email, a follow-up email, then a call.
 *
 * It reads only the contact log. What counts is the unanswered outreach since
 * the last time the partner responded, so a reply resets the ladder and a
 * partner who goes quiet mid-deal climbs it again. Days are working days
 * (Monday to Friday), because a follow-up due on a Saturday is really due on
 * Monday.
 */
import type { Channel, Outcome, PartnerStatus } from "./model";

export type LadderTouch = { channel: Channel; outcome: Outcome; on: string };

export type NextStep = {
  action: string;
  /** YYYY-MM-DD; null when there is no deadline (a prospect waiting its turn). */
  due: string | null;
  /** Where on the ladder: 0 first email, 1 follow-up, 2 call, 3 call again, 4 out of steps. */
  rung: number | null;
  planned?: boolean;
};

/** Working days to wait after each rung before the next one is due. */
export const LADDER_WAIT_DAYS = { followUp: 4, call: 3, callAgain: 3, giveUp: 5 } as const;

export const LADDER_RUNGS = ["Email", "Follow-up email", "Call", "Call again"] as const;

export function addWorkingDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

const isCall = (t: LadderTouch) => t.channel === "call";

export function nextStep(
  status: PartnerStatus,
  touches: LadderTouch[],
  followUpOn: string | null = null,
): NextStep | null {
  if (status === "live" || status === "paused" || status === "declined") {
    return followUpOn ? { action: "Planned check-in", due: followUpOn, rung: null, planned: true } : null;
  }

  const sorted = [...touches].sort((a, b) => a.on.localeCompare(b.on));
  const last = sorted.at(-1);

  // A date someone agreed with the partner beats the ladder, until a contact
  // is logged on or after it.
  if (followUpOn && (!last || followUpOn > last.on)) {
    return { action: "Planned follow-up", due: followUpOn, rung: null, planned: true };
  }

  if (!last) return { action: "Send the first email", due: null, rung: 0 };

  let lastReply = -1;
  sorted.forEach((t, i) => {
    if (t.outcome === "replied") lastReply = i;
  });
  const unanswered = sorted.slice(lastReply + 1);

  // They spoke last: the ball is in our court.
  if (unanswered.length === 0) {
    return { action: "Reply to them", due: addWorkingDays(last.on, 1), rung: null };
  }

  // One round per day: emailing three centres of the same group on the same
  // morning is one attempt, not three rungs.
  const emailDays = new Set(unanswered.filter((t) => !isCall(t)).map((t) => t.on)).size;
  const calls = new Set(unanswered.filter(isCall).map((t) => t.on)).size;
  const at = unanswered.at(-1)!.on;
  if (calls === 0) {
    return emailDays <= 1
      ? { action: "Send a follow-up email", due: addWorkingDays(at, LADDER_WAIT_DAYS.followUp), rung: 1 }
      : { action: "Call them", due: addWorkingDays(at, LADDER_WAIT_DAYS.call), rung: 2 };
  }
  if (calls === 1) {
    return { action: "Call again", due: addWorkingDays(at, LADDER_WAIT_DAYS.callAgain), rung: 3 };
  }
  return {
    action: "No answer after two calls: try another contact, or pause",
    due: addWorkingDays(at, LADDER_WAIT_DAYS.giveUp),
    rung: 4,
  };
}

export type Urgency = "overdue" | "today" | "soon" | "later" | "none";

export function urgency(due: string | null, today: string): Urgency {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= addWorkingDays(today, 2) ? "soon" : "later";
}
