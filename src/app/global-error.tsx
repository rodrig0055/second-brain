"use client";

// global-error replaces the root layout, so it brings its own stylesheets in the same order.
import "./layers.css";
import "./globals.css";
import "./stylex.css";
import { useEffect } from "react";
import { AstryxRoot } from "@/components/astryx-root";
import { ErrorState } from "@/components/feedback/error-state";

/** The root layout itself failed. Last line of defence: no app frame, just a way back. */
export default function GlobalError({
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
    <html lang="en">
      <body className="bg-surface text-primary">
        <title>Something went wrong | Second Brain</title>
        <AstryxRoot>
          <ErrorState
            kind="error"
            title="Something went wrong"
            description="The Brain couldn't load. Try again, and if it keeps happening, send the reference below to whoever looks after it."
            digest={error.digest}
            onRetry={unstable_retry}
          />
        </AstryxRoot>
      </body>
    </html>
  );
}
