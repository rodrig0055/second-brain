"use client";

import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Check, Copy, ExternalLink, Loader2, Mail, Sparkles } from "lucide-react";

import { draftEmail, logTouch } from "@/app/(app)/t/[team]/partners/actions";
import { DRAFT_PURPOSES, PURPOSE_LABELS, gmailComposeUrl, type DraftPurpose } from "@/lib/partners/email";
import { inputClass, labelClass } from "./bits";

type Contact = { id: string; name: string; email: string };

/**
 * Draft the next email, edit it, open it in Gmail, then log it. The log entry
 * is a separate click on purpose: opening Gmail is not sending, and the ladder
 * should only move when the email actually went out.
 */
export function EmailDraftPanel({
  teamSlug,
  partnerId,
  contacts,
  defaultContactId,
  defaultPurpose,
  account,
}: {
  teamSlug: string;
  partnerId: string;
  contacts: Contact[];
  defaultContactId: string;
  defaultPurpose: DraftPurpose;
  account: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState(defaultContactId);
  const [purpose, setPurpose] = useState<DraftPurpose>(defaultPurpose);
  const [instructions, setInstructions] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const [drafting, startDraft] = useTransition();
  const hasDraft = Boolean(subject || body);

  const generate = () =>
    startDraft(async () => {
      setError("");
      setLogged(false);
      const r = await draftEmail({ teamSlug, partnerId, contactId, purpose, instructions });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSubject(r.subject);
      setBody(r.body);
      setTo(r.to);
    });

  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (!open) {
    return (
      <Button label="Draft email" icon={<Icon icon={Sparkles} />} size="sm" onClick={() => setOpen(true)} />
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
          <Mail className="size-3.5" />
          Draft an email
        </p>
        <Button label="Close" variant="ghost" size="sm" onClick={() => setOpen(false)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          To
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
            {contacts.length === 0 && <option value="">No contact yet</option>}
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.email}
                {c.name && c.email ? ` (${c.email})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Purpose
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as DraftPurpose)} className={inputClass}>
            {DRAFT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        Anything to add (optional)
        <input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Mention Christmas hampers, keep it to three lines..."
          className={inputClass}
        />
      </label>
      <Button
        label={drafting ? "Writing…" : hasDraft ? "Write it again" : "Write draft"}
        icon={drafting ? <Icon icon={Loader2} className="animate-spin" /> : <Icon icon={Sparkles} />}
        variant="primary"
        size="sm"
        onClick={generate}
        isDisabled={drafting}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}

      {hasDraft && (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          <label className={labelClass}>
            To
            <input value={to} onChange={(e) => setTo(e.target.value)} type="email" className={inputClass} />
          </label>
          <label className={labelClass}>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            Body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className={`${inputClass} font-[inherit] leading-relaxed`} />
          </label>
          {/\[[^\]]+\]/.test(subject + body) && (
            <p className="text-xs text-amber-700">Fill in the [bracketed] parts before sending.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              label="Open in Gmail"
              href={gmailComposeUrl({ to, subject, body, account })}
              target="_blank"
              rel="noreferrer"
              icon={<Icon icon={ExternalLink} />}
              variant="primary"
              size="sm"
            />
            <Button
              label={copied ? "Copied" : "Copy body"}
              icon={<Icon icon={copied ? Check : Copy} />}
              size="sm"
              onClick={copy}
            />
            {/* A plain form action, not a call from code: that is what refreshes the
                log and the next step behind it once the entry is saved. */}
            <form action={logTouch} onSubmit={() => setLogged(true)}>
              <input type="hidden" name="teamSlug" value={teamSlug} />
              <input type="hidden" name="partnerId" value={partnerId} />
              <input type="hidden" name="channel" value="email" />
              <input type="hidden" name="outcome" value="sent" />
              <input type="hidden" name="contactId" value={contacts.find((c) => c.email && c.email === to)?.id ?? contactId} />
              <input type="hidden" name="note" value={`Sent: ${subject}`} />
              <Button
                type="submit"
                label={logged ? "Logged" : "Log as sent"}
                icon={logged ? <Icon icon={Check} color="success" /> : undefined}
                size="sm"
                isDisabled={logged}
              />
            </form>
          </div>
          <p className="text-[0.6875rem] text-zinc-400">
            Gmail opens in your account: switch From to marketing@bloomly-sg.example there if that is the sender. For a follow-up, replying
            in the original thread keeps the history together; use Copy body for that. Press Log as sent once it has gone.
          </p>
        </div>
      )}
    </div>
  );
}
