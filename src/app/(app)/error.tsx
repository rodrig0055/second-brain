"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/feedback/error-state";

/**
 * Any signed-in page that throws. Sits inside the (app) layout, so the sidebar stays and the user
 * can go elsewhere instead of facing a blank screen.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      kind="error"
      title="This page hit a problem"
      description="Something failed while loading it. Trying again usually works; if it keeps happening, send the reference below to whoever looks after the Brain."
      digest={error.digest}
      onRetry={unstable_retry}
    />
  );
}
