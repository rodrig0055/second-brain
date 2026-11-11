"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button, type ButtonProps } from "@astryxdesign/core/Button";
import { splitMessage } from "@/lib/confirm-message";

/**
 * A submit button that asks first, in an Astryx AlertDialog instead of the browser's `confirm()`.
 *
 * The click is held, the question is asked, and "yes" re-submits the same form with this button as
 * the submitter, so its `name`/`value` and any `formAction` (a per-button server action) travel
 * exactly as an unguarded click would have sent them.
 *
 * `message` is written as one or two sentences ("Delete “X”? This cannot be undone."): the first
 * becomes the dialog title, the rest its description. The action button reads `confirmLabel`, else
 * the button's `label`. The trigger is an Astryx Button, `ghost` by default: these sit inline in
 * rows and forms, and the dialog is where the destructive colour belongs.
 */
export function ConfirmSubmitButton({
  message,
  confirmLabel,
  tone = "danger",
  formAction,
  variant = "ghost",
  size = "sm",
  ...props
}: Omit<ButtonProps, "type" | "onClick" | "clickAction" | "href"> & {
  message: string;
  confirmLabel?: string;
  /** "danger" (default) for deletes and removals; "default" for reversible moves like Pause. */
  tone?: "default" | "danger";
  /** A per-button server action, sent as the native `formaction` of the submitter. */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { title, description } = splitMessage(message);

  return (
    <>
      <Button
        {...props}
        // Astryx Button spreads unknown props onto the <button>, so the native formAction reaches it.
        {...(formAction ? ({ formAction } as object) : null)}
        variant={variant}
        size={size}
        ref={button}
        type="submit"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      />
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        actionLabel={confirmLabel ?? props.label}
        actionVariant={tone === "danger" ? "destructive" : "primary"}
        onAction={() => {
          const el = button.current;
          setOpen(false);
          // `requestSubmit` does not fire click, so this does not loop back into the guard above.
          el?.form?.requestSubmit(el);
        }}
      />
    </>
  );
}
