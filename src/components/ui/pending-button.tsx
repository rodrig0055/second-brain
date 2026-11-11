"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@astryxdesign/core/Button";
import { Spinner } from "@astryxdesign/core/Spinner";

/**
 * A submit button that says what it is doing while its form's action runs.
 *
 * Every submit button in the form is disabled while it runs; the one that was pressed (matched on
 * `name`/`value` when several share a form) swaps its text for `pending` and shows a spinner. The
 * text stays visible on purpose: these actions take seconds, and "Asking every assistant…" says why.
 */
export function PendingButton({
  pending,
  name,
  value,
  icon,
  label,
  children,
  ...props
}: Omit<ButtonProps, "type" | "isLoading" | "value"> & {
  /** Text shown on the pressed button while the action runs. */
  pending: string;
  value?: string;
}) {
  const status = useFormStatus();
  const mine = status.pending && (!name || status.data?.get(name) === value);
  return (
    <Button
      {...props}
      type="submit"
      name={name}
      value={value}
      label={mine ? pending : label}
      icon={mine ? <Spinner size="sm" shade="inherit" /> : icon}
      isDisabled={status.pending}
    >
      {mine ? undefined : children}
    </Button>
  );
}
