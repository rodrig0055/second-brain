/**
 * One status vocabulary for the whole app.
 *
 * Every status pill reads its colour from here, so "draft" on Social, "new" on
 * a lead and "overdue" on a follow-up mean the same thing wherever they show:
 *
 *   attention  waiting on a person (amber). The loudest calm state on purpose.
 *   danger     broken or late (red).
 *   progress   moving without anyone's help (blue).
 *   scheduled  held for a later time (cyan).
 *   success    done, live, healthy (green).
 *   info       a category with no urgency (purple).
 *   muted      closed: rejected, lost, declined (gray).
 *   neutral    no opinion (default).
 */

export type StatusTone =
  | "attention"
  | "danger"
  | "progress"
  | "scheduled"
  | "success"
  | "info"
  | "muted"
  | "neutral";

/** Astryx Token colours, one per tone. */
export const TONE_COLOR = {
  attention: "yellow",
  danger: "red",
  progress: "blue",
  scheduled: "cyan",
  success: "green",
  info: "purple",
  muted: "gray",
  neutral: "default",
} as const satisfies Record<StatusTone, string>;

export type ToneColor = (typeof TONE_COLOR)[StatusTone];

/** Astryx StatusDot variants, for the tones a dot can carry. */
export const TONE_DOT = {
  attention: "warning",
  danger: "error",
  progress: "accent",
  scheduled: "accent",
  success: "success",
  info: "accent",
  muted: "neutral",
  neutral: "neutral",
} as const satisfies Record<StatusTone, string>;

type Entry = { tone: StatusTone; label?: string };

/**
 * Known statuses. Keys are the raw values the database and the APIs use; the
 * label, when given, is what a person reads instead of the raw value.
 */
export const STATUSES: Record<string, Entry> = {
  // Runs and jobs.
  running: { tone: "progress" },
  pending: { tone: "progress" },
  done: { tone: "success" },
  error: { tone: "danger" },
  failed: { tone: "danger" },
  // Connections.
  active: { tone: "success" },
  connected: { tone: "success" },
  disconnected: { tone: "muted" },
  stale: { tone: "attention" },
  // Proposed changes (CMS, Merchant Center titles, admin proposals).
  applying: { tone: "progress" },
  applied: { tone: "success" },
  rejected: { tone: "muted" },
  // Corporate CRM stages. "new" is the loud one: an untouched lead needs a human.
  new: { tone: "attention" },
  contacted: { tone: "progress" },
  quoted: { tone: "info" },
  won: { tone: "success" },
  lost: { tone: "muted" },
  // Social drafts. `draft` and `failed` wait on a person; `scheduled` means Meta holds the post.
  draft: { tone: "attention" },
  approved: { tone: "progress" },
  publishing: { tone: "progress" },
  scheduled: { tone: "scheduled" },
  published: { tone: "success" },
  discarded: { tone: "muted" },
  planned: { tone: "neutral" },
  // Partners.
  prospect: { tone: "neutral" },
  talks: { tone: "info", label: "In talks" },
  live: { tone: "success" },
  paused: { tone: "attention" },
  declined: { tone: "muted" },
  // Follow-ups and freshness.
  overdue: { tone: "danger" },
  "due-soon": { tone: "attention", label: "Due soon" },
  // Learning-loop verdicts.
  validated: { tone: "success" },
  invalidated: { tone: "danger" },
  inconclusive: { tone: "attention" },
  insufficient: { tone: "muted", label: "Not enough data" },
  // Newsletters.
  needs_art: { tone: "attention", label: "Needs hero art" },
  ready: { tone: "success", label: "Approved" },
  handed_off: { tone: "progress", label: "In SendPulse" },
  sent: { tone: "success" },
  archived: { tone: "muted" },
  // Reports.
  "no-data": { tone: "attention", label: "No data" },
};

/** "due-soon" -> "Due soon", "running" -> "Running". */
function humanize(status: string): string {
  const words = status.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : status;
}

/** Tone and label for any status, known or not. Unknown values read as neutral. */
export function statusInfo(status: string): { tone: StatusTone; label: string } {
  const entry = STATUSES[status];
  return { tone: entry?.tone ?? "neutral", label: entry?.label ?? humanize(status) };
}
