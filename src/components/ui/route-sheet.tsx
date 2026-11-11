"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Sheet } from "@/components/ui/sheet";

/**
 * A route shown in the side panel over the list it was opened from (an
 * intercepted /new or /[id]). Closing goes back, which is what restores the
 * list: the panel is a route, not a toggle. A save that redirects to the list
 * closes it too, because the list route renders no panel.
 */
export function RouteSheet({
  title,
  description,
  width = 768,
  children,
}: {
  title: string;
  description?: string;
  /** Desktop width budget: pixels, or any CSS length. */
  width?: number | string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    // Let the Drawer slide out, then leave the route.
    window.setTimeout(() => router.back(), 220);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title={title}
      description={description}
      width={width}
    >
      {children}
    </Sheet>
  );
}
