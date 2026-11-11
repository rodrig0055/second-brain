/**
 * Read model for the partner tracker: one row per partner with its primary
 * contact, its last contact and the next step on the follow-up ladder, all
 * derived at read time from the append-only contact log.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { partnerContacts, partners, partnerTouches, teams, userTeamAccess, users } from "@/db/schema";
import { todayIn } from "@/lib/date-range";
import { nextStep, urgency, type NextStep, type Urgency } from "./ladder";
import {
  PARTNERS_TZ,
  PARTNERSHIPS_TEAM_SLUG,
  isChannel,
  isOutcome,
  isStatus,
  type Channel,
  type Outcome,
  type PartnerStatus,
} from "./model";

export type PartnerContact = typeof partnerContacts.$inferSelect;

export type PartnerTouch = {
  id: string;
  channel: Channel;
  outcome: Outcome;
  on: string;
  note: string;
  contactId: string | null;
  contactName: string;
  userId: string | null;
  authorName: string;
  createdAt: string;
};

export type PartnerRow = {
  id: string;
  name: string;
  kind: string; // a built-in PartnerKind or a type the team added
  status: PartnerStatus;
  ownerId: string | null;
  ownerName: string;
  codes: string[];
  website: string;
  notes: string;
  followUpOn: string | null;
  primary: PartnerContact | null;
  contactCount: number;
  lastTouch: PartnerTouch | null;
  touchCount: number;
  next: NextStep | null;
  urgency: Urgency;
  updatedAt: string;
};

export function today(): string {
  return todayIn(PARTNERS_TZ);
}

function label(u: { name: string | null; email: string } | null | undefined): string {
  if (!u) return "";
  return u.name || u.email.split("@")[0];
}

function contactLabel(c: PartnerContact | undefined): string {
  if (!c) return "";
  return c.name || c.email || c.phone;
}

/** Primary first, then oldest: the order contacts were added in. */
function sortContacts(cs: PartnerContact[]): PartnerContact[] {
  return [...cs].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || +a.createdAt - +b.createdAt);
}

async function build(rows: (typeof partners.$inferSelect)[]): Promise<PartnerRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [contacts, touches, people] = await Promise.all([
    db.select().from(partnerContacts).where(inArray(partnerContacts.partnerId, ids)),
    db
      .select()
      .from(partnerTouches)
      .where(inArray(partnerTouches.partnerId, ids))
      .orderBy(asc(partnerTouches.on), asc(partnerTouches.createdAt)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const now = today();

  return rows.map((p) => {
    const cs = sortContacts(contacts.filter((c) => c.partnerId === p.id));
    const ts: PartnerTouch[] = touches
      .filter((t) => t.partnerId === p.id && isChannel(t.channel) && isOutcome(t.outcome))
      .map((t) => ({
        id: t.id,
        channel: t.channel as Channel,
        outcome: t.outcome as Outcome,
        on: t.on,
        note: t.note,
        contactId: t.contactId,
        contactName: contactLabel(t.contactId ? contactById.get(t.contactId) : undefined),
        userId: t.userId,
        authorName: label(t.userId ? personById.get(t.userId) : null),
        createdAt: t.createdAt.toISOString(),
      }));
    const status: PartnerStatus = isStatus(p.status) ? p.status : "prospect";
    const next = nextStep(status, ts, p.followUpOn);
    return {
      id: p.id,
      name: p.name,
      kind: p.kind || "other",
      status,
      ownerId: p.ownerId,
      ownerName: label(p.ownerId ? personById.get(p.ownerId) : null),
      codes: p.codes ?? [],
      website: p.website,
      notes: p.notes,
      followUpOn: p.followUpOn,
      primary: cs[0] ?? null,
      contactCount: cs.length,
      lastTouch: ts.at(-1) ?? null,
      touchCount: ts.length,
      next,
      urgency: urgency(next?.due ?? null, now),
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

const URGENCY_ORDER: Record<Urgency, number> = { overdue: 0, today: 1, soon: 2, later: 3, none: 4 };

/** Whatever is due first sits at the top; partners with no deadline sort by name. */
export function byDue(a: PartnerRow, b: PartnerRow): number {
  return (
    URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
    (a.next?.due ?? "9999").localeCompare(b.next?.due ?? "9999") ||
    a.name.localeCompare(b.name)
  );
}

export async function loadPartners(brandId: string): Promise<PartnerRow[]> {
  const rows = await db.select().from(partners).where(eq(partners.brandId, brandId));
  return (await build(rows)).sort(byDue);
}

export async function loadPartner(
  brandId: string,
  id: string,
): Promise<{ partner: PartnerRow; contacts: PartnerContact[]; touches: PartnerTouch[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await db.query.partners.findFirst({ where: and(eq(partners.id, id), eq(partners.brandId, brandId)) });
  if (!row) return null;
  const [partner] = await build([row]);
  const [contacts, touchRows] = await Promise.all([
    db.select().from(partnerContacts).where(eq(partnerContacts.partnerId, id)),
    db
      .select({ t: partnerTouches, name: users.name, email: users.email })
      .from(partnerTouches)
      .leftJoin(users, eq(users.id, partnerTouches.userId))
      .where(eq(partnerTouches.partnerId, id))
      .orderBy(desc(partnerTouches.on), desc(partnerTouches.createdAt)),
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const touches: PartnerTouch[] = touchRows
    .filter(({ t }) => isChannel(t.channel) && isOutcome(t.outcome))
    .map(({ t, name, email }) => ({
      id: t.id,
      channel: t.channel as Channel,
      outcome: t.outcome as Outcome,
      on: t.on,
      note: t.note,
      contactId: t.contactId,
      contactName: contactLabel(t.contactId ? contactById.get(t.contactId) : undefined),
      userId: t.userId,
      authorName: email ? label({ name, email }) : "",
      createdAt: t.createdAt.toISOString(),
    }));
  return { partner, contacts: sortContacts(contacts), touches };
}

/** Owners are the Partnerships team's own members, not every user. */
export async function loadPartnerOwners(): Promise<{ id: string; label: string }[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(userTeamAccess, eq(userTeamAccess.userId, users.id))
    .innerJoin(teams, eq(teams.id, userTeamAccess.teamId))
    .where(eq(teams.slug, PARTNERSHIPS_TEAM_SLUG))
    .orderBy(users.email);
  return rows.map((u) => ({ id: u.id, label: label(u) }));
}

/** Every type a partner of this brand uses, built-in or added by the team. */
export async function loadPartnerKinds(brandId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ kind: partners.kind }).from(partners).where(eq(partners.brandId, brandId));
  return rows.map((r) => r.kind);
}
