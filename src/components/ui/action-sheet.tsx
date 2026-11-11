"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";

import { Sheet } from "@/components/ui/sheet";

/**
 * A button that opens a form in the side panel, for create forms that used to
 * sit open on the page. The form is passed in as-is, server action and all.
 *
 * `closeOn="submit"` (default) closes as soon as the form submits: right for
 * quick saves, whose action revalidates the list behind the panel. For slow
 * actions use `closeOn="done"` with a SheetSubmitButton, which shows the
 * action working and closes the panel when it finishes. Browser validation
 * runs first either way, so an invalid form never fires and stays open.
 */

const CloseContext = createContext<() => void>(() => {});

export function ActionSheet({
  label,
  title,
  description,
  width = 576,
  variant = "primary",
  closeOn = "submit",
  icon,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  /** Desktop width budget: pixels, or any CSS length. */
  width?: number | string;
  variant?: "primary" | "secondary";
  closeOn?: "submit" | "done";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Button
        label={label}
        variant={variant}
        icon={icon ?? <Icon icon={Plus} />}
        onClick={() => setOpen(true)}
      />
      <Sheet open={open} onOpenChange={setOpen} title={title} description={description} width={width}>
        <CloseContext.Provider value={close}>
          <VStack
            // Capture: runs after validation passed and the action started.
            onSubmitCapture={closeOn === "submit" ? () => window.setTimeout(close, 0) : undefined}
          >
            {children}
          </VStack>
        </CloseContext.Provider>
      </Sheet>
    </>
  );
}

/**
 * Submit button for a form inside an ActionSheet with `closeOn="done"`: shows
 * the action working, then closes the panel when it finishes. An action that
 * redirects closes it by navigating away instead.
 */
export function SheetSubmitButton({
  className,
  pendingLabel = "Working…",
  variant = "secondary",
  width,
  children,
}: {
  className?: string;
  pendingLabel?: string;
  variant?: ButtonProps["variant"];
  width?: ButtonProps["width"];
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  const close = useContext(CloseContext);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) close();
    wasPending.current = pending;
  }, [pending, close]);

  // Button needs a string label. Callers pass plain text; anything richer
  // still renders as children, with a generic accessible name.
  const isText = typeof children === "string" || typeof children === "number";
  return (
    <Button
      type="submit"
      isDisabled={pending}
      label={pending ? pendingLabel : isText ? String(children) : "Submit"}
      icon={pending ? <Icon icon={Loader2} className="animate-spin" /> : undefined}
      variant={variant}
      width={width}
      className={className}
    >
      {pending || isText ? undefined : children}
    </Button>
  );
}
