"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";

import { Sheet } from "@/components/ui/sheet";
import { ComposeForm } from "../../compose/compose-form";

/**
 * The composer in a side panel. Closing goes back, which is what restores the
 * page underneath: the panel is a route, not a toggle.
 */
export function ComposeSheet(props: Omit<ComponentProps<typeof ComposeForm>, "shell" | "onCancel">) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    // Let the slide-out finish, then leave the route and pick up new drafts.
    window.setTimeout(() => {
      router.back();
      router.refresh();
    }, 220);
  }

  return (
    <ComposeForm
      {...props}
      onCancel={close}
      shell={(body, footer) => (
        <Sheet
          open={open}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
          title="Create post"
          description="Write once, for every brand you run."
          footer={footer}
          padding={0}
        >
          {body}
        </Sheet>
      )}
    />
  );
}
