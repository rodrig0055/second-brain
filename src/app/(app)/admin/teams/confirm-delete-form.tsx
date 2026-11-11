"use client";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

/**
 * Wraps a delete server action in a form that asks for confirmation (an Astryx AlertDialog)
 * before submitting. Used for team / department deletes on /admin/teams.
 */
export function ConfirmDeleteForm({
  action,
  id,
  message,
  title,
}: {
  action: (formData: FormData) => void;
  id: string;
  message: string;
  title?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <ConfirmSubmitButton message={message} tooltip={title} label="Delete" />
    </form>
  );
}
