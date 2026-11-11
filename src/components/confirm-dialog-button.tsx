"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * A button that asks before it submits its form.
 *
 * Every move between order states is irreversible by design: "Accepted as-is" tells the rest of
 * the pipeline the customer said yes, and nothing downstream re-asks. So a mis-click is not a
 * hypothetical.
 *
 * The dialog itself is <ConfirmDialog> (Astryx AlertDialog, or Dialog when it carries fields);
 * this component is only the trigger. Where the trigger is something other than a button (a menu
 * item, say), use the dialog directly.
 */
export function ConfirmDialogButton({
  label,
  title,
  body,
  confirmLabel,
  tone = "default",
  formId,
  children,
}: {
  label: string;
  title: string;
  body: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  /** The `<form>` this dialog submits. The dialog is portalled, so it cannot be inferred. */
  formId: string;
  /** Extra fields shown inside the dialog: the reviewer's name, for instance. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        label={label}
        size="sm"
        variant={tone === "danger" ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      />

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        body={body}
        confirmLabel={confirmLabel ?? label}
        tone={tone}
        formId={formId}
      >
        {children}
      </ConfirmDialog>
    </>
  );
}
