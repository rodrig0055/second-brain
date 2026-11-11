"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh while something is mid-publish.
 *
 * Publishing a Reel takes up to two minutes on Meta's side, so a static page
 * would leave someone staring at "publishing" with no way to tell whether it
 * was progressing. Mounted only while a row is actually in flight.
 */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    // A background tab has nobody watching it, so it should not keep re-rendering the server
    // page every few seconds. Pause while hidden; on return, refresh once at once, then resume.
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(id);
      id = setInterval(() => router.refresh(), everyMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(id);
      } else {
        router.refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, everyMs]);
  return null;
}
