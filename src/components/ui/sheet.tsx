"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer";
import { HStack, Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";

/** The first thing to type into: where a create or edit panel should open. */
const FIRST_FIELD = "textarea, input:not([type=hidden]):not([type=checkbox])";

/**
 * A panel that slides in from the right over the page it was opened from.
 *
 * Creating something should not cost you the list you were looking at, so create and edit flows open
 * here instead of on a page of their own. Astryx Drawer handles the focus trap, Escape, the scrim and
 * returning focus to the trigger. `purpose="form"`: Escape closes, but a stray click on the scrim does
 * not throw away what was typed.
 *
 * Controlled only: the caller owns `open`, usually from the URL, so a refresh or a shared link lands in
 * the same state.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  width = 1024,
  padding = 6,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Pinned to the bottom: the actions, so they never scroll out of reach. */
  footer?: ReactNode;
  /** Desktop width budget: pixels, or any CSS length. Phones get the full width. */
  width?: number | string;
  /** Body inset on the spacing scale. 0 for a body that lays out its own columns and padding. */
  padding?: 0 | 6;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDialogElement>(null);

  // Land in the first field, not on the close button. Runs after the Drawer's own open focus.
  useEffect(() => {
    if (!open) return;
    // preventScroll: mid slide-in the field reads as off-screen, and scrolling to it would hide the top.
    const frame = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Drawer
      ref={panel}
      isOpen={open}
      onOpenChange={onOpenChange}
      label={title}
      width={width}
      purpose="form"
      padding={0}
      experimental={{ isFullWidthOnMobile: true }}
    >
      <Layout
        header={
          <LayoutHeader hasDivider padding={6} paddingBlockEnd={4}>
            <DrawerHeader title={title} subtitle={description} onOpenChange={onOpenChange} />
          </LayoutHeader>
        }
        content={<LayoutContent padding={padding}>{children}</LayoutContent>}
        footer={
          footer ? (
            <LayoutFooter hasDivider padding={0} className="px-6 py-3">
              <HStack gap={3} vAlign="center" hAlign="between">
                {footer}
              </HStack>
            </LayoutFooter>
          ) : undefined
        }
      />
    </Drawer>
  );
}

