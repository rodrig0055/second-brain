"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renameConversation } from "@/app/(app)/chat/actions";
import { isImeEnter } from "@/lib/keyboard";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Pencil } from "lucide-react";

/**
 * Inline-editable conversation title. Shows the title with a quiet pencil
 * affordance on hover; clicking (or the pencil) swaps to an input that commits
 * on Enter/blur and reverts on Escape.
 */
export function EditableTitle({
  conversationId,
  title,
}: {
  conversationId: string;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function commit() {
    const next = value.trim();
    setEditing(false);
    if (!next || next === title) {
      setValue(title);
      return;
    }
    setPending(true);
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("title", next);
    await renameConversation(fd);
    setPending(false);
    router.refresh();
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Conversation title"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (isImeEnter(e)) return;
            commit();
          } else if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        maxLength={120}
        className="u-transition w-full rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-sm font-medium text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20"
      />
    );
  }

  return (
    <Button
      label={value}
      tooltip="Rename chat"
      variant="ghost"
      size="sm"
      onClick={() => setEditing(true)}
      className={`group/title max-w-full ${pending ? "opacity-60" : ""}`}
      endContent={
        <Icon
          icon={Pencil}
          size="xsm"
          color="tertiary"
          className="opacity-0 transition-opacity duration-[var(--app-duration-normal)] ease-[var(--ease-smooth)] group-hover/title:opacity-100"
        />
      }
    />
  );
}
