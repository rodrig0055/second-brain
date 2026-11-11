/**
 * The partner tracker's vocabulary. Pure data, no db, so the pages, the
 * actions and the tests all read the same lists.
 */
export { PARTNERSHIPS_TEAM_SLUG } from "@/lib/workspaces";

/** Partnerships are Bloomly SG's for now; every partner belongs to this brand. */
export const PARTNERS_BRAND_SLUG = "bloomly-sg";
export const PARTNERS_TZ = "Asia/Singapore";
export const PARTNERS_CURRENCY = "SGD";

export const PARTNER_STATUSES = ["prospect", "contacted", "talks", "live", "paused", "declined"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const STATUS_LABELS: Record<PartnerStatus, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  talks: "In talks",
  live: "Live",
  paused: "Paused",
  declined: "Declined",
};

export const STATUS_HINTS: Record<PartnerStatus, string> = {
  prospect: "Not contacted yet",
  contacted: "Reached out, no reply yet",
  talks: "They replied; working out a deal",
  live: "Deal running, code live",
  paused: "On hold, by us or by them",
  declined: "Said no, or never answered",
};

export const PARTNER_KINDS = ["platform", "school", "preschool", "corporate", "media", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const KIND_LABELS: Record<PartnerKind, string> = {
  platform: "Perks platform",
  school: "School",
  preschool: "Preschool",
  corporate: "Corporate",
  media: "Media",
  other: "Other",
};

export const CHANNELS = ["email", "call", "whatsapp", "meeting"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  call: "Call",
  whatsapp: "WhatsApp",
  meeting: "Meeting",
};

export const OUTCOMES = ["sent", "replied"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function isStatus(v: unknown): v is PartnerStatus {
  return PARTNER_STATUSES.includes(v as PartnerStatus);
}
export function isKind(v: unknown): v is PartnerKind {
  return PARTNER_KINDS.includes(v as PartnerKind);
}
/**
 * The team can add its own types (Insurance, Bank, Health) next to the
 * built-in ones. A custom type is stored as its name, so it exists for as long
 * as a partner uses it and needs no table of its own.
 */
export const NEW_KIND = "new-kind"; // never a stored type: resolveKind capitalises typed names
export const KIND_MAX = 40;

export function kindLabel(kind: string): string {
  return isKind(kind) ? KIND_LABELS[kind] : kind;
}

/**
 * A typed type name, matched against what already exists so "insurance" joins
 * "Insurance" and "media" is the built-in Media. Empty when nothing was typed.
 */
export function resolveKind(raw: string, known: readonly string[]): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, KIND_MAX);
  if (!name) return "";
  const lower = name.toLowerCase();
  const builtin = PARTNER_KINDS.find((k) => k === lower || KIND_LABELS[k].toLowerCase() === lower);
  if (builtin) return builtin;
  return known.find((k) => k.toLowerCase() === lower) ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** Built-in types in their fixed order, then the team's own A-Z. */
export function kindOptions(used: readonly string[]): { value: string; label: string }[] {
  const custom = [...new Set(used.filter((k) => k && !isKind(k)))].sort((a, b) => a.localeCompare(b));
  return [...PARTNER_KINDS, ...custom].map((k) => ({ value: k, label: kindLabel(k) }));
}

export function isChannel(v: unknown): v is Channel {
  return CHANNELS.includes(v as Channel);
}
export function isOutcome(v: unknown): v is Outcome {
  return OUTCOMES.includes(v as Outcome);
}

/**
 * What logging a contact does to the status. It only ever moves forward, and
 * only out of the two outreach stages: a live partner stays live when someone
 * logs a check-in call.
 */
export function statusAfterTouch(current: PartnerStatus, outcome: Outcome): PartnerStatus {
  if (current === "prospect") return outcome === "replied" ? "talks" : "contacted";
  if (current === "contacted" && outcome === "replied") return "talks";
  return current;
}
