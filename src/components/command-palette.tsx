"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  Handshake,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Plus,
  Search,
} from "lucide-react";
import { CommandPalette as AstryxCommandPalette, CommandPaletteInput } from "@astryxdesign/core/CommandPalette";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { SearchableItem, SearchSource } from "@astryxdesign/core/Typeahead";
import type { PaletteHit } from "@/lib/command-palette";

/** A place the palette can take you: a page in the nav, an action, or a record. */
export type PaletteEntry = { id: string; label: string; href: string; group: string; hint?: string };

type Item = SearchableItem<PaletteEntry>;

const GROUP_ICONS: Record<string, typeof ArrowRight> = {
  Actions: Plus,
  "Recent chats": MessageSquare,
  Chats: MessageSquare,
  "Task templates": ListChecks,
  "Image templates": ImageIcon,
  Partners: Handshake,
  Search: Search,
};

const toItem = (e: PaletteEntry): Item => ({ id: e.id, label: e.label, auxiliaryData: e });

function matches(entry: PaletteEntry, q: string) {
  const lower = q.toLowerCase();
  return entry.label.toLowerCase().includes(lower) || (entry.hint?.toLowerCase().includes(lower) ?? false);
}

/**
 * Cmd+K: jump to any page, start the common actions, or open a chat, template or partner by name.
 *
 * - Pages and actions come from the nav the server already built (`entries`), so the palette can
 *   never offer a page the sidebar would not.
 * - Records come from `/api/command-palette`, scoped like the pages they open. Local matches show
 *   at once; the server's join them when it answers, and a newer keystroke cancels the request.
 * - The last row always offers the full-text search page for the query.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
  entries,
  actions,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Pages: the workspace links, team workspaces, their tabs and Settings sections. */
  entries: PaletteEntry[];
  /** Shown before typing, and matched like pages after. */
  actions: PaletteEntry[];
}) {
  const router = useRouter();
  const shown = useRef(new Map<string, PaletteEntry>());
  const inflight = useRef<AbortController | null>(null);

  const source = useMemo<SearchSource<Item>>(() => {
    const remember = (list: PaletteEntry[]) => {
      for (const e of list) shown.current.set(e.id, e);
      return list.map(toItem);
    };
    const fetchHits = async (q: string): Promise<PaletteHit[]> => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      try {
        const res = await fetch(`/api/command-palette?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return [];
        return ((await res.json()) as { hits: PaletteHit[] }).hits;
      } catch {
        return [];
      }
    };
    return {
      bootstrap: async () => {
        const recent = await fetchHits("");
        return remember([...actions, ...recent, ...entries.filter((e) => e.group === "Workspace")]);
      },
      search: async (query, context) => {
        const q = query.trim();
        const local = [...actions, ...entries].filter((e) => matches(e, q)).slice(0, 12);
        const everything: PaletteEntry = {
          id: `search:${q}`,
          label: `Search everything for “${q}”`,
          href: `/search?q=${encodeURIComponent(q)}`,
          group: "Search",
        };
        context?.update(remember([...local, everything]));
        const remote = await fetchHits(q);
        return remember([...local, ...remote, everything]);
      },
      cancel: () => inflight.current?.abort(),
    };
  }, [entries, actions]);

  return (
    <AstryxCommandPalette<Item>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Go to or search"
      searchSource={source}
      input={<CommandPaletteInput label="Go to or search" placeholder="Jump to a page, chat, template or partner…" />}
      // Controlled and always empty: every choice navigates, so picking the same row twice must
      // still fire.
      value=""
      onValueChange={(id) => {
        const entry = shown.current.get(id);
        if (entry) router.push(entry.href);
      }}
      emptySearchText="Nothing matches. Press Enter on “Search everything” for full-text results."
      renderItem={(item) => {
        const e = item.auxiliaryData!;
        return (
          <HStack gap={2} vAlign="center" className="min-w-0 flex-1">
            <Icon icon={GROUP_ICONS[e.group] ?? (e.group === "Actions" ? Plus : e.href.startsWith("/admin") ? FileText : ArrowRight)} size="sm" color="secondary" />
            <Text maxLines={1} className="min-w-0 flex-1">
              {e.label}
            </Text>
            {e.hint && (
              <Text type="supporting" color="secondary" maxLines={1}>
                {e.hint}
              </Text>
            )}
          </HStack>
        );
      }}
    />
  );
}
