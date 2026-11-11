"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/page-header";

export type RouteHeaderEntry = {
  href: string;
  title: string;
  description?: string;
  /** This page draws its own header (it has actions of its own), so skip it here. */
  ownHeader?: boolean;
  /** Pages below this one (a detail page) draw their own header. */
  childrenOwnHeader?: boolean;
};

/**
 * The page header for a section whose layout, not its pages, owns the title.
 *
 * A layout does not re-render on navigation, so the title follows the URL from
 * the client: the longest entry that is the current path or a parent of it
 * wins, so a detail page under a section keeps the section's title.
 */
export function RouteHeader({
  entries,
  action,
}: {
  entries: RouteHeaderEntry[];
  action?: ReactNode;
}) {
  const pathname = usePathname();
  const match = entries
    .filter((e) => pathname === e.href || pathname.startsWith(`${e.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!match || match.ownHeader) return null;
  if (match.childrenOwnHeader && pathname !== match.href) return null;
  return <PageHeader title={match.title} description={match.description} action={action} />;
}
