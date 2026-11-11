/**
 * The email draft's pure half: purposes, the sender's name, the dash rule and
 * the Gmail compose link. No server imports, so the draft panel can use it.
 */
import type { PartnerRow } from "./data";

export const DRAFT_PURPOSES = ["first", "follow_up", "reply", "check_in"] as const;
export type DraftPurpose = (typeof DRAFT_PURPOSES)[number];

export const PURPOSE_LABELS: Record<DraftPurpose, string> = {
  first: "First email",
  follow_up: "Follow-up (no answer yet)",
  reply: "Reply to their last message",
  check_in: "Check-in with a live partner",
};

export function isPurpose(v: unknown): v is DraftPurpose {
  return DRAFT_PURPOSES.includes(v as DraftPurpose);
}

/** What the ladder says the next email is. */
export function defaultPurpose(p: Pick<PartnerRow, "status" | "next" | "touchCount">): DraftPurpose {
  if (p.status === "live" || p.status === "paused") return "check_in";
  if (p.touchCount === 0) return "first";
  if (p.next?.action === "Reply to them") return "reply";
  return "follow_up";
}

/** Our sender's first name: the users row says "Admin" for one account, so fall back to the email. */
export function senderName(user: { name: string | null; email: string }): string {
  const fromName = user.name?.trim().split(/\s+/)[0];
  if (fromName && fromName.toLowerCase() !== "admin") return fromName;
  const local = user.email.split("@")[0].split(/[._-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Models put em dashes in no matter what they are told; the house rule is none. */
export function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
}

/**
 * A Gmail compose window with the draft filled in, opened in the sender's own
 * account (authuser), so it goes out from Gmail like any other email and the
 * From can be switched to marketing@bloomly-sg.example there.
 */
export function gmailComposeUrl(d: { to: string; cc?: string; subject: string; body: string; account: string }): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", authuser: d.account, to: d.to, su: d.subject, body: d.body });
  if (d.cc) q.set("cc", d.cc);
  return `https://mail.google.com/mail/?${q.toString()}`;
}
