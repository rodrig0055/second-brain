"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

/**
 * Classify what the nightly pass has not got to yet.
 *
 * The nightly job takes twenty ads per account, which clears a backlog over a
 * few days. This is for when someone wants a specific window classified now —
 * after a launch, say. Client-driven because a full-video pass through Gemini
 * runs past any single request's budget, so the browser keeps asking until the
 * account reports nothing left.
 */
export function AnalyzeNow({
  connections,
  range,
  unclassified,
}: {
  connections: { id: string; brandId: string; name: string }[];
  range: { start: string; end: string };
  unclassified: number;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [note, setNote] = useState("");

  async function run() {
    setRunning(true);
    setDone(0);
    setNote("");
    let classified = 0;
    try {
      for (const conn of connections) {
        // Each pass classifies a dozen or so; keep going until this account
        // says there is nothing left.
        for (let pass = 0; pass < 200; pass += 1) {
          const res = await fetch("/api/meta/creatives/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              connectionId: conn.id,
              brandId: conn.brandId,
              startDate: range.start,
              endDate: range.end,
            }),
          });
          if (!res.ok || !res.body) {
            setNote(`${conn.name}: could not start.`);
            break;
          }
          const text = await res.text();
          const events = text
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => {
              try {
                return JSON.parse(l.slice(5)) as { type?: string; remaining?: number };
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          classified += events.filter((e) => e?.type === "classified").length;
          setDone(classified);
          const finished = events.find((e) => e?.type === "done");
          if (!finished || (finished.remaining ?? 0) === 0) break;
        }
      }
      setNote(classified ? `Classified ${classified}.` : "Nothing left to classify.");
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  if (unclassified === 0 && !running && !note) {
    return <span className="text-[0.65rem] text-zinc-400">Everything in this window is classified.</span>;
  }

  return (
    <span className="flex items-center gap-2">
      {unclassified > 0 && !running && (
        <span className="text-[0.65rem] text-zinc-500">
          {unclassified} not classified yet; the nightly pass does 20 per account.
        </span>
      )}
      <Button
        onClick={run}
        isDisabled={running}
        label={running ? `Classifying… ${done}` : "Classify now"}
        icon={<Icon icon={Sparkles} className={running ? "animate-pulse" : undefined} />}
        size="sm"
      />
      {note && <span className="text-[0.65rem] text-emerald-700">{note}</span>}
    </span>
  );
}
