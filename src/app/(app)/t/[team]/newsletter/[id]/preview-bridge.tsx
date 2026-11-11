"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Pencil } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

/**
 * Glue between the editable preview iframe and the server.
 *
 * The iframe posts {type:"nl-edit", index, field, value} when a piece of copy
 * is edited in place; this forwards it to the same server action the block
 * form uses, so both editing paths write identically. Copy/Download fetch the
 * plain (non-edit) preview URL — that HTML is byte-for-byte what a handoff
 * would send to SendPulse.
 */
export function PreviewBridge({
  teamSlug,
  campaignId,
  previewUrl,
  onEdit,
}: {
  teamSlug: string;
  campaignId: string;
  previewUrl: string;
  onEdit: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Each message here becomes a saved edit, so only the same-origin preview frame may send
      // one. Without this, any page holding a reference to this tab (one that opened it with
      // window.open, say) could post edits into the campaign.
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; index?: number; field?: string; value?: string };
      if (!d || d.type !== "nl-edit" || typeof d.index !== "number" || !d.field) return;
      const fd = new FormData();
      fd.set("teamSlug", teamSlug);
      fd.set("campaignId", campaignId);
      fd.set("blockIndex", String(d.index));
      fd.set("field", d.field);
      fd.set("value", d.value ?? "");
      start(async () => {
        await onEdit(fd);
        setSaved(`${d.field} saved`);
        router.refresh();
        setTimeout(() => setSaved(null), 1800);
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [teamSlug, campaignId, onEdit, router]);

  async function copyHtml() {
    const html = await (await fetch(previewUrl, { cache: "no-store" })).text();
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function downloadHtml() {
    const html = await (await fetch(previewUrl, { cache: "no-store" })).text();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `newsletter-${campaignId.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 text-zinc-500">
        <Pencil className="size-3.5" /> Click any text in the preview to edit it
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {pending && <span className="text-zinc-400">saving…</span>}
        {saved && !pending && <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="size-3.5" />{saved}</span>}
        <Button label={copied ? "Copied" : "Copy HTML"} size="sm" onClick={copyHtml}
          icon={<Icon icon={copied ? Check : Copy} />} />
        <Button label="Download .html" size="sm" onClick={downloadHtml}
          icon={<Icon icon={Download} />} />
      </span>
    </div>
  );
}
