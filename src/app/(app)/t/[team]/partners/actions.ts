"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { partnerContacts, partners, partnerTouches } from "@/db/schema";
import { isYmd } from "@/lib/date-range";
import { parsePatterns } from "@/lib/partners/codes";
import { loadPartner, loadPartnerKinds, today } from "@/lib/partners/data";
import { draftPartnerEmail } from "@/lib/partners/draft";
import { defaultPurpose, isPurpose } from "@/lib/partners/email";
import { partnerPath, partnersPath, requirePartnershipsTeam, salesPath } from "@/lib/partners/gate";
import {
  KIND_MAX,
  NEW_KIND,
  isChannel,
  isOutcome,
  isStatus,
  resolveKind,
  statusAfterTouch,
  type PartnerStatus,
} from "@/lib/partners/model";

/**
 * Every action re-authorises from scratch: the team slug is a form field, so it
 * is client supplied. Each one also re-checks that the partner it addresses
 * belongs to the tracker's brand before touching it.
 */
async function authorize(formData: FormData) {
  return requirePartnershipsTeam(String(formData.get("teamSlug") ?? ""));
}

function str(formData: FormData, key: string, max = 255): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

async function ownPartner(brandId: string, formData: FormData) {
  const id = str(formData, "partnerId", 64);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    (await db.query.partners.findFirst({ where: and(eq(partners.id, id), eq(partners.brandId, brandId)) })) ?? null
  );
}

async function validOwner(raw: string): Promise<string | null> {
  if (!raw) return null;
  const u = await db.query.users.findFirst({ where: (u, { eq: is }) => is(u.id, raw), columns: { id: true } });
  return u?.id ?? null;
}

/**
 * The Type picker: an existing type, or "New type..." plus the name typed next
 * to it. Either way the name is matched against the types already in use.
 */
async function readKind(brandId: string, formData: FormData, fallback: string): Promise<string> {
  const known = await loadPartnerKinds(brandId);
  const picked = str(formData, "kind", KIND_MAX);
  const kind = picked === NEW_KIND ? resolveKind(str(formData, "newKind", KIND_MAX), known) : resolveKind(picked, known);
  return kind || fallback;
}

function refresh(id?: string) {
  revalidatePath(partnersPath());
  revalidatePath(salesPath());
  if (id) revalidatePath(partnerPath(id));
}

export async function createPartner(formData: FormData) {
  const { user, brand } = await authorize(formData);
  const name = str(formData, "name");
  if (!name) return;
  const status = str(formData, "status");

  const existing = await db.query.partners.findFirst({
    where: and(eq(partners.brandId, brand.id), eq(partners.name, name)),
  });
  if (existing) redirect(partnerPath(existing.id));

  const [row] = await db
    .insert(partners)
    .values({
      brandId: brand.id,
      name,
      kind: await readKind(brand.id, formData, "other"),
      status: isStatus(status) ? status : "prospect",
      ownerId: (await validOwner(str(formData, "ownerId", 64))) ?? user.id,
      codes: parsePatterns(str(formData, "codes", 1000)),
      website: str(formData, "website", 500),
      createdBy: user.id,
    })
    .returning();

  const contact = {
    name: str(formData, "contactName"),
    role: str(formData, "contactRole"),
    email: str(formData, "contactEmail").toLowerCase(),
    phone: str(formData, "contactPhone", 50),
  };
  if (contact.name || contact.email || contact.phone) {
    await db.insert(partnerContacts).values({ partnerId: row.id, isPrimary: true, ...contact });
  }

  refresh(row.id);
  redirect(partnerPath(row.id));
}

export async function updatePartner(formData: FormData) {
  const { brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  if (!p) return;
  const name = str(formData, "name") || p.name;
  const kind = await readKind(brand.id, formData, p.kind);
  const status = str(formData, "status");
  const followUpOn = str(formData, "followUpOn", 10);
  const nextStatus: PartnerStatus = isStatus(status) ? status : (p.status as PartnerStatus);

  await db
    .update(partners)
    .set({
      name,
      kind,
      status: nextStatus,
      statusChangedAt: nextStatus === p.status ? p.statusChangedAt : new Date(),
      ownerId: await validOwner(str(formData, "ownerId", 64)),
      codes: parsePatterns(str(formData, "codes", 1000)),
      website: str(formData, "website", 500),
      notes: str(formData, "notes", 5000),
      followUpOn: isYmd(followUpOn) ? followUpOn : null,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, p.id));
  refresh(p.id);
}

/** Status alone, from the quick picker at the top of the partner page. */
export async function setPartnerStatus(formData: FormData) {
  const { brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  const status = str(formData, "status");
  if (!p || !isStatus(status) || status === p.status) return;
  await db
    .update(partners)
    .set({ status, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(partners.id, p.id));
  refresh(p.id);
}

/**
 * Log an email, call, message or meeting. This is the one write the follow-up
 * ladder reads, and it moves a prospect or a contacted partner forward.
 */
export async function logTouch(formData: FormData) {
  const { user, brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  if (!p) return;
  const channel = str(formData, "channel");
  const outcome = str(formData, "outcome");
  if (!isChannel(channel) || !isOutcome(outcome)) return;
  const onRaw = str(formData, "on", 10);
  const on = isYmd(onRaw) && onRaw <= today() ? onRaw : today();

  const contactRaw = str(formData, "contactId", 64);
  const contact = contactRaw
    ? await db.query.partnerContacts.findFirst({
        where: and(eq(partnerContacts.id, contactRaw), eq(partnerContacts.partnerId, p.id)),
      })
    : undefined;

  await db.insert(partnerTouches).values({
    partnerId: p.id,
    contactId: contact?.id ?? null,
    channel,
    outcome,
    on,
    note: str(formData, "note", 5000),
    userId: user.id,
  });

  const status = statusAfterTouch(isStatus(p.status) ? p.status : "prospect", outcome);
  await db
    .update(partners)
    .set({
      status,
      statusChangedAt: status === p.status ? p.statusChangedAt : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(partners.id, p.id));
  refresh(p.id);
}

/** A mistyped log entry. Only the person who logged it, or an admin, may remove it. */
export async function deleteTouch(formData: FormData) {
  const { user, brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  const id = str(formData, "touchId", 64);
  if (!p || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const t = await db.query.partnerTouches.findFirst({
    where: and(eq(partnerTouches.id, id), eq(partnerTouches.partnerId, p.id)),
  });
  if (!t || (t.userId !== user.id && user.role !== "admin")) return;
  await db.delete(partnerTouches).where(eq(partnerTouches.id, t.id));
  refresh(p.id);
}

export async function saveContact(formData: FormData) {
  const { brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  if (!p) return;
  const values = {
    name: str(formData, "name"),
    role: str(formData, "role"),
    email: str(formData, "email").toLowerCase(),
    phone: str(formData, "phone", 50),
  };
  if (!values.name && !values.email && !values.phone) return;
  const makePrimary = formData.get("isPrimary") === "on";
  const id = str(formData, "contactId", 64);

  const existing = id
    ? await db.query.partnerContacts.findFirst({
        where: and(eq(partnerContacts.id, id), eq(partnerContacts.partnerId, p.id)),
      })
    : undefined;
  const others = await db.select({ id: partnerContacts.id }).from(partnerContacts).where(eq(partnerContacts.partnerId, p.id));
  // The first contact is the primary one whether or not the box was ticked.
  const primary = makePrimary || others.length === 0 || (existing?.isPrimary ?? false);

  if (primary) {
    await db.update(partnerContacts).set({ isPrimary: false }).where(eq(partnerContacts.partnerId, p.id));
  }
  if (existing) {
    await db.update(partnerContacts).set({ ...values, isPrimary: primary }).where(eq(partnerContacts.id, existing.id));
  } else {
    await db.insert(partnerContacts).values({ partnerId: p.id, ...values, isPrimary: primary });
  }
  await db.update(partners).set({ updatedAt: new Date() }).where(eq(partners.id, p.id));
  refresh(p.id);
}

export async function deleteContact(formData: FormData) {
  const { brand } = await authorize(formData);
  const p = await ownPartner(brand.id, formData);
  const id = str(formData, "contactId", 64);
  if (!p || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const [gone] = await db
    .delete(partnerContacts)
    .where(and(eq(partnerContacts.id, id), eq(partnerContacts.partnerId, p.id)))
    .returning();
  // Never leave a partner without a primary while it still has contacts.
  if (gone?.isPrimary) {
    const next = await db.query.partnerContacts.findFirst({
      where: eq(partnerContacts.partnerId, p.id),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    });
    if (next) await db.update(partnerContacts).set({ isPrimary: true }).where(eq(partnerContacts.id, next.id));
  }
  refresh(p.id);
}

export async function deletePartner(formData: FormData) {
  const { user, brand } = await authorize(formData);
  if (user.role !== "admin") return;
  const p = await ownPartner(brand.id, formData);
  if (!p) return;
  await db.delete(partners).where(eq(partners.id, p.id));
  refresh();
  redirect(partnersPath());
}

export type DraftResult =
  | { ok: true; subject: string; body: string; to: string; contactId: string | null }
  | { ok: false; error: string };

/**
 * Write a draft of the next email to a partner. Returns it to the panel and
 * stores nothing: it only becomes a log entry once someone sends it and
 * presses "Log as sent".
 */
export async function draftEmail(input: {
  teamSlug: string;
  partnerId: string;
  contactId: string;
  purpose: string;
  instructions: string;
}): Promise<DraftResult> {
  const { user, team, brand } = await requirePartnershipsTeam(input.teamSlug);
  const found = await loadPartner(brand.id, input.partnerId);
  if (!found) return { ok: false, error: "Partner not found." };
  const to = found.contacts.find((c) => c.id === input.contactId) ?? found.partner.primary ?? null;
  const purpose = isPurpose(input.purpose) ? input.purpose : defaultPurpose(found.partner);
  try {
    const d = await draftPartnerEmail({
      partner: found.partner,
      contacts: found.contacts,
      touches: found.touches,
      to,
      purpose,
      instructions: String(input.instructions ?? "").trim().slice(0, 1000),
      sender: user,
      brandId: brand.id,
      teamId: team.id,
    });
    return { ok: true, subject: d.subject, body: d.body, to: to?.email ?? "", contactId: to?.id ?? null };
  } catch (err) {
    console.error("[partners] draft failed", err);
    return { ok: false, error: "No model could write the draft just now. Try again in a minute." };
  }
}
