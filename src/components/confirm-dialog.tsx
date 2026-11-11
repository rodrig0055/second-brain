"use client";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

/**
 * A question asked in the middle of the screen, over everything else, before a form is submitted.
 *
 * Two shapes, one API:
 * - **No extra fields**: an Astryx AlertDialog (role="alertdialog", Cancel takes focus, Escape
 *   cancels, a backdrop click does not dismiss). Confirming submits the form named by `formId`.
 * - **With extra fields** (`children`: the reviewer's name, a pair of "I have downloaded it"
 *   checkboxes): an Astryx Dialog with purpose="form", whose submit button belongs to that form, so
 *   the browser validates `required` fields before anything is sent.
 *
 * Both render in the top layer, so the `animate-enter` transform trap (a transformed ancestor
 * becomes the containing block for `position: fixed`) cannot catch them. Fields inside carry
 * `form={formId}`: HTML form association works across the portal, DOM nesting does not.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  tone = "default",
  formId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  /** The `<form>` this dialog's fields and submit button belong to. */
  formId: string;
  /** Extra fields shown inside the dialog: the reviewer's name, for instance. */
  children?: React.ReactNode;
}) {
  const variant = tone === "danger" ? "destructive" : "primary";
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  if (!children) {
    return (
      <AlertDialog
        isOpen={open}
        onOpenChange={onOpenChange}
        title={title}
        description={body}
        actionLabel={confirmLabel}
        actionVariant={variant}
        onAction={() => {
          submitForm(formId);
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} purpose="form" width={440}>
      <Layout
        height="auto"
        header={<DialogHeader title={title} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              <Text as="p" color="secondary">
                {body}
              </Text>
              {children}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="ghost" onClick={onClose} />
              <Button label={confirmLabel} variant={variant} type="submit" form={formId} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/**
 * Submits a form the way its own submit button would: through `requestSubmit`, so validation runs,
 * a `submit` event fires (React server actions and `onSubmit` handlers both listen for it), and,
 * when `submitter` is given, its `name`/`value`/`formAction` travel with the submission.
 */
export function submitForm(formId: string, submitter?: HTMLElement | null) {
  const form = document.getElementById(formId);
  if (!(form instanceof HTMLFormElement)) return;
  form.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined);
}
