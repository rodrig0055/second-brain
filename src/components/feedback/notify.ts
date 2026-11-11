"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useToast } from "@astryxdesign/core/Toast";

/**
 * The app's one way to say "that worked" or "that failed" without blocking anyone.
 *
 * - `notify.success("Template saved")`: info toast, hides after 5 s.
 * - `notify.error("Couldn't delete the video")`: error toast, stays until dismissed.
 *
 * Pass `id` when the same action can fire repeatedly (a Save clicked twice) so the second toast
 * replaces the first instead of stacking. Keep messages to a few words; anything the user must act
 * on belongs in a Banner or inline next to the field, not in a toast.
 */
export function useNotify() {
  const showToast = useToast();
  return useMemo(
    () => ({
      success: (body: string, id?: string) => showToast({ body, type: "info", uniqueID: id }),
      error: (body: string, id?: string) => showToast({ body, type: "error", uniqueID: id }),
    }),
    [showToast],
  );
}

/** What a server action hands back to `useActionState` when it wants the user told. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string } | null | undefined;

/**
 * Toasts each new server-action result once: `useActionResultToast(state)` next to
 * `const [state, action] = useActionState(...)`. A result without a message stays silent, so an
 * action that redirects or updates the page in place does not also need a toast.
 */
export function useActionResultToast(state: ActionResult) {
  const notify = useNotify();
  const seen = useRef<ActionResult>(state);
  const show = useCallback(
    (s: NonNullable<ActionResult>) => {
      if (s.ok) {
        if (s.message) notify.success(s.message);
      } else {
        notify.error(s.error);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    show(state);
  }, [state, show]);
}
