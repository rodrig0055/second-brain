import "server-only";

/**
 * A first draft of the next email to a partner, written from what the tracker
 * knows: the partner, the deal notes, the contact log and where it sits on the
 * follow-up ladder. Nothing is sent from here. The person edits the draft,
 * sends it from their own Gmail and logs it.
 */
import { generateObject } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { PASS_MODELS, resolveModel } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import type { PartnerContact, PartnerRow, PartnerTouch } from "./data";
import { senderName, stripDashes, type DraftPurpose } from "./email";
import { CHANNEL_LABELS, STATUS_LABELS, kindLabel } from "./model";

const PURPOSE_BRIEF: Record<DraftPurpose, string> = {
  first:
    "This is the first email to this partner. Introduce Bloomly SG in one line, make one clear offer for their community, say what we would ask of them, and end with one easy next step (a short call or a yes by reply).",
  follow_up:
    "We emailed before and have had no answer. Write a short, friendly follow-up: two to four sentences, restate the offer in one line, make it easy to say yes or to point us to the right person. Do not guilt them for not replying.",
  reply:
    "They replied last. Answer what they said or asked, as shown in the contact log, and move the deal one step forward. If the log does not show what they asked, write [what they asked] where the answer goes.",
  check_in:
    "The partnership is running. Write a short check-in: thank them, give one useful update or idea (a seasonal moment, fresh artwork, a reminder blast), and ask one question. Quote no sales figures.",
};

const draftSchema = z.object({
  subject: z.string().describe("Email subject line, under 80 characters."),
  body: z.string().describe("Plain-text email body, from the greeting to the sign-off. No signature after the sign-off."),
});

export type EmailDraft = z.infer<typeof draftSchema>;

/** The house writing rules, when an admin has kept them in the knowledge base. */
async function writingRules(): Promise<string> {
  const doc = await db.query.knowledgeDocs.findFirst({
    where: and(eq(knowledgeDocs.slug, "anti-ai-slop"), isNull(knowledgeDocs.brandId)),
    columns: { content: true },
  });
  return doc?.content ?? "";
}

// The house style for outreach: short, specific, one clear ask. Replace with one of your own.
const STYLE_EXAMPLE = `Subject: An exclusive discount for your members: Bloomly SG x Riverside University

Hi Riverside Student Union team,

I'm Sam from Bloomly SG, an online florist and gift shop. We do graduation bouquets, flower boxes, cakes and gift hampers, all with free nationwide delivery.

Graduation is one of our busiest seasons, and we'd like to give your students something better than a generic promo: an exclusive code just for your community.

- 20% off with the code RIVER20, capped at $10 per order, on top of free delivery
- For students, graduates and their families, at graduation and every occasion after that

All we'd ask is that you share it in your student channels and list it among your member perks. We're happy to send ready-made artwork and report back on how many members used it.

Could we set up a quick 15-minute call in the next couple of weeks?

Kind regards,`;

function historyText(touches: PartnerTouch[], contacts: PartnerContact[]): string {
  if (touches.length === 0) return "No contact logged yet.";
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return touches
    .slice(0, 8)
    .map((t) => {
      const who = t.contactId ? byId.get(t.contactId) : undefined;
      const dir = t.outcome === "replied" ? "they responded" : "we reached out, no answer";
      return `- ${t.on} ${CHANNEL_LABELS[t.channel]} (${dir})${who ? ` with ${who.name || who.email}` : ""}: ${t.note || "no note"}`;
    })
    .join("\n");
}

export async function draftPartnerEmail(args: {
  partner: PartnerRow;
  contacts: PartnerContact[];
  touches: PartnerTouch[];
  to: PartnerContact | null;
  purpose: DraftPurpose;
  instructions: string;
  sender: { id: string; name: string | null; email: string };
  brandId: string;
  teamId: string;
}): Promise<EmailDraft> {
  const { partner: p, to, purpose } = args;
  const name = senderName(args.sender);
  const rules = await writingRules();

  const system =
    `You write partnership emails for Bloomly SG, a Singapore online florist and gift shop (bouquets, flower boxes, cakes, gift hampers). ` +
    `${name} from the Bloomly SG team is the sender. Its main selling point is FREE delivery nationwide; mention it when it fits.\n` +
    `Rules:\n` +
    `- Always write the brand as "Bloomly SG", never "Bloomly" or "bloomly-sg.example".\n` +
    `- Quote a discount, code, cap, date or term only if it appears in the partner's deal notes, codes or contact log. Never invent one. If the email needs an offer and none is given, write [offer].\n` +
    `- Never invent facts about the partner, past orders or results. Where a detail is needed and unknown, use a [bracketed placeholder].\n` +
    `- Plain text, short paragraphs, at most one short bullet list. British spelling. Warm and direct, not salesy.\n` +
    `- No em dashes or en dashes anywhere.\n` +
    `- Greet the recipient by first name when known, else the team ("Hi Kaplan Student Engagement team,").\n` +
    `- End with exactly "Kind regards," on its own line and nothing after it: the signature is added by Gmail.\n` +
    `Match the tone and shape of this email, which the team sent before:\n\n${STYLE_EXAMPLE}` +
    (rules ? `\n\nHouse writing rules:\n${rules}` : "");

  const prompt =
    `Partner: ${p.name} (${kindLabel(p.kind)}), status ${STATUS_LABELS[p.status]}.\n` +
    (p.website ? `Website: ${p.website}\n` : "") +
    `Voucher codes: ${p.codes.length ? p.codes.join(", ") : "none yet"}\n` +
    `Deal notes: ${p.notes || "none"}\n` +
    `Recipient: ${to ? [to.name, to.role, to.email].filter(Boolean).join(", ") : "no named contact"}\n` +
    `Contact log, newest first:\n${historyText(args.touches, args.contacts)}\n\n` +
    `Task: ${PURPOSE_BRIEF[purpose]}` +
    (args.instructions ? `\nExtra instructions from ${name}: ${args.instructions}` : "");

  // Three providers in order, so one out of credit or without a key still
  // leaves the person with a draft.
  let lastError: unknown = null;
  for (const id of [PASS_MODELS.partnerDraft, PASS_MODELS.reviewDraftFallback, PASS_MODELS.reviewDraftFallback2]) {
    try {
      const model = await resolveModel(id);
      const r = await generateObject({ model, schema: draftSchema, system, prompt });
      await logUsage({ kind: "task", model: id, usage: r.usage, userId: args.sender.id, brandId: args.brandId, teamId: args.teamId, refId: p.id });
      return { subject: stripDashes(r.object.subject.trim()), body: stripDashes(r.object.body.trim()) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No model could write this draft.");
}
