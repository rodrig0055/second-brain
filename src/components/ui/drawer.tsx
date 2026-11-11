"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer as AstryxDrawer } from "@astryxdesign/core/Drawer";

/**
 * The frame for a right-hand detail panel whose caller draws its own header and body.
 *
 * Astryx Drawer supplies the focus trap, Escape and scrim dismissal, an inert page underneath and
 * focus handed back to the opener. Unlike <Sheet>, this adds no chrome of its own, so each panel keeps
 * the header it already had (with its own close button: the Drawer renders none).
 *
 * Mount it only while open; the caller's conditional render is the open state.
 */
export function Drawer({
  label,
  onClose,
  width = 448,
  children,
}: {
  /** The accessible name announced when the panel opens; usually what its header shows. */
  label: string;
  onClose: () => void;
  /** Desktop width budget: pixels, or any CSS length. */
  width?: number | string;
  children: ReactNode;
}) {
  // Callers close by unmounting, which skips the Drawer's own focus return (that runs when `isOpen`
  // flips). Remember what had focus when the panel mounted and hand it back when it goes, so a
  // keyboard user who opened a row with Enter does not land on <body>. Captured during render: the
  // Drawer moves focus into the panel before an effect here could read it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => {
    return () => {
      setTimeout(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [opener]);

  return (
    <AstryxDrawer
      isOpen
      onOpenChange={(open) => !open && onClose()}
      label={label}
      width={width}
      padding={0}
      experimental={{ isFullWidthOnMobile: true }}
    >
      {children}
    </AstryxDrawer>
  );
}
