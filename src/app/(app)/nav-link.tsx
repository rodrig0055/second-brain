"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Sidebar nav item. Active routes get a filled neutral treatment; the icon
 * (rendered server-side and passed in) leads a truncated label.
 */
export function NavLink({
  href,
  label,
  icon,
  exact = false,
  preserveParams,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  exact?: boolean;
  /**
   * Query keys to carry over from the current URL. A channel workspace passes
   * its brand scope and date window so moving between tabs keeps the view the
   * person set, instead of resetting to the default brand.
   */
  preserveParams?: string[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = exact
    ? pathname === href
    : href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  let target = href;
  if (preserveParams?.length) {
    const carry = new URLSearchParams();
    for (const key of preserveParams) {
      const value = params.get(key);
      if (value) carry.set(key, value);
    }
    const qs = carry.toString();
    if (qs) target = `${href}?${qs}`;
  }

  return (
    <Link
      href={target}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-9 items-center gap-2.5 truncate rounded-lg px-2.5 py-2 text-sm ${
        active
          ? "bg-zinc-100 font-medium text-zinc-900 shadow-card"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      }`}
    >
      {icon && (
        <span className={`shrink-0 ${active ? "text-zinc-900" : "text-zinc-400"}`}>
          {icon}
        </span>
      )}
      <span className="truncate">{label}</span>
    </Link>
  );
}
