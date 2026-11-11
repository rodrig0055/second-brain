"use client";

import { useEffect, useId, useState } from "react";
import type { OutputKind } from "@/lib/image-output";
import {
  COMPLEXITIES,
  COMPLEXITY_LABELS,
  manualSettings,
  ruleSettings,
  type Complexity,
  type ImageSettings,
} from "@/lib/image-settings";

// Wait for typing to pause before reading the brief, so a sentence costs one
// classifier call rather than one per keystroke.
const DEBOUNCE_MS = 900;
const MIN_BRIEF_CHARS = 12;

/**
 * The auto pick for the current brief. GIF and SVG are decided by rule on the
 * client; still images ask the server, which reads the brief.
 */
export function useAutoImageSettings({
  enabled,
  brandId,
  brief,
  hasReferences,
  output,
}: {
  enabled: boolean;
  brandId: string;
  brief: string;
  hasReferences: boolean;
  output: OutputKind;
}): { auto: ImageSettings | null; loading: boolean } {
  // Each pick is stored with the exact inputs it was made for, so a pick for an
  // older brief is never shown or sent once the brief has changed.
  const [result, setResult] = useState<{ key: string; settings: ImageSettings | null } | null>(
    null,
  );
  const trimmed = brief.trim();
  const key = JSON.stringify([trimmed, hasReferences, output, brandId]);
  const ruled = enabled ? ruleSettings({ hasReferences, output }) : null;
  const shouldFetch = enabled && !ruled && trimmed.length >= MIN_BRIEF_CHARS && Boolean(brandId);

  useEffect(() => {
    if (!shouldFetch) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/images/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: trimmed, hasReferences, output, brandId }),
          signal: ctrl.signal,
        });
        // A failed preview is not an error for the person: the generate route
        // reads the brief itself when no settings come with the run.
        const settings = res.ok ? ((await res.json()) as ImageSettings) : null;
        if (!ctrl.signal.aborted) setResult({ key, settings });
      } catch {
        if (!ctrl.signal.aborted) setResult({ key, settings: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [shouldFetch, key, trimmed, hasReferences, output, brandId]);

  if (!enabled) return { auto: null, loading: false };
  if (ruled) return { auto: ruled, loading: false };
  if (!shouldFetch) return { auto: null, loading: false };
  // Until the pick for these exact inputs lands, show "reading" and send none
  // (the generate route then reads the brief itself).
  if (result?.key !== key) return { auto: null, loading: true };
  return { auto: result.settings, loading: false };
}

/** What the run will be sent with: the auto pick, or the person's override. */
export function effectiveSettings(
  choice: "auto" | Complexity,
  auto: ImageSettings | null,
): ImageSettings | null {
  if (choice === "auto") return auto;
  return manualSettings(choice, auto?.fineDetail ?? false);
}

export function PlanningControl({
  choice,
  onChange,
  auto,
  loading,
}: {
  choice: "auto" | Complexity;
  onChange: (next: "auto" | Complexity) => void;
  auto: ImageSettings | null;
  loading: boolean;
}) {
  const id = useId();
  const autoLabel = auto ? `Auto (${auto.complexity})` : "Auto";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs text-zinc-600">
        Planning <span className="text-zinc-400">(GPT Image 2.6)</span>
      </label>
      <select
        id={id}
        value={choice}
        onChange={(e) => onChange(e.target.value as "auto" | Complexity)}
        className="u-transition w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
      >
        <option value="auto">{autoLabel}</option>
        {COMPLEXITIES.map((c) => (
          <option key={c} value={c}>
            {COMPLEXITY_LABELS[c]}
          </option>
        ))}
      </select>
      <p className="text-xs leading-5 text-zinc-500" aria-live="polite">
        {choice !== "auto" ? (
          "Set by you. Low keeps references exact; high lets the model redesign."
        ) : loading ? (
          <span className="u-shimmer">Reading your brief…</span>
        ) : auto ? (
          auto.reason
        ) : (
          "Write your brief and the planning level is picked for you."
        )}
      </p>
    </div>
  );
}
