import type { ReactNode } from "react";

/**
 * A Settings form opened as its own page: a shared link or a refresh. From
 * the list the same URL opens in the side panel instead (see @sheet).
 */
export function FormPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-4xl">
      <h2 className="mb-6 text-sm font-medium text-zinc-700">{title}</h2>
      {children}
    </div>
  );
}
