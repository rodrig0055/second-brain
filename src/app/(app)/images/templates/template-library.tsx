"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Plus } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import {
  createFolder,
  deleteFolder,
  deleteTemplate,
  moveTemplate,
  renameFolder,
} from "./actions";

export type LibraryTemplate = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  referenceUrls: string[];
  brandId: string | null;
  brandName: string | null;
  folderId: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Runs started from this template, by anyone. */
  uses: number;
  /** Runs started from this template by the viewer. */
  myUses: number;
  myLastUsed: string | null;
};

type Option = { id: string; name: string };
type Sort = "popular" | "recent" | "newest" | "name";

// Virtual folders. Real folders are keyed by their uuid, so these can never collide.
const ALL = "";
const UNFILED = "unfiled";
const RECENT = "recent";

const SORT_LABELS: Record<Sort, string> = {
  popular: "Most used",
  recent: "Recently used by me",
  newest: "Newest",
  name: "Name (A-Z)",
};

const controlCls =
  "h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none focus:border-zinc-400";

type Filters = { q: string; brand: string; type: string; mine: boolean };

function matchesFilters(
  t: LibraryTemplate,
  f: Filters,
  tokens: string[],
  folderName: string,
  currentUserId: string,
) {
  // A brand filter shows what is usable for that brand, so all-brand templates stay in.
  if (f.brand === "global" && t.brandId) return false;
  if (f.brand && f.brand !== "global" && t.brandId && t.brandId !== f.brand) return false;
  if (f.type === "reference" && t.referenceUrls.length === 0) return false;
  if (f.type === "prompt" && t.referenceUrls.length > 0) return false;
  if (f.mine && t.createdById !== currentUserId) return false;
  if (tokens.length === 0) return true;
  const haystack = [
    t.name,
    t.description,
    t.prompt,
    t.brandName ?? "all brands",
    folderName,
    t.createdByName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((tok) => haystack.includes(tok));
}

function inFolder(t: LibraryTemplate, folder: string) {
  if (folder === ALL) return true;
  if (folder === UNFILED) return t.folderId === null;
  if (folder === RECENT) return t.myLastUsed !== null;
  return t.folderId === folder;
}

// Searching ranks name hits above matches buried in a prompt, so the obvious template comes first.
function nameScore(t: LibraryTemplate, q: string, tokens: string[]) {
  const name = t.name.toLowerCase();
  if (name.includes(q)) return 2;
  if (tokens.every((tok) => name.includes(tok))) return 1;
  return 0;
}

function compare(sort: Sort) {
  const newest = (a: LibraryTemplate, b: LibraryTemplate) =>
    b.createdAt.localeCompare(a.createdAt);
  switch (sort) {
    case "popular":
      return (a: LibraryTemplate, b: LibraryTemplate) =>
        b.uses - a.uses || b.myUses - a.myUses || newest(a, b);
    case "recent":
      return (a: LibraryTemplate, b: LibraryTemplate) =>
        (b.myLastUsed ?? "").localeCompare(a.myLastUsed ?? "") || newest(a, b);
    case "name":
      return (a: LibraryTemplate, b: LibraryTemplate) => a.name.localeCompare(b.name);
    default:
      return newest;
  }
}

export function TemplateLibrary({
  templates,
  folders,
  brands,
  currentUserId,
  initial,
}: {
  templates: LibraryTemplate[];
  folders: Option[];
  brands: Option[];
  currentUserId: string;
  initial: {
    q: string;
    folder: string;
    brand: string;
    type: string;
    mine: boolean;
    sort: string;
  };
}) {
  const [q, setQ] = useState(initial.q);
  const [folder, setFolder] = useState(initial.folder);
  const [brand, setBrand] = useState(initial.brand);
  const [type, setType] = useState(initial.type);
  const [mine, setMine] = useState(initial.mine);
  const [sort, setSort] = useState<Sort | "">(
    initial.sort in SORT_LABELS ? (initial.sort as Sort) : "",
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // A folder deleted elsewhere (or a stale link) falls back to everything rather than an empty page.
  const folderIds = new Set(folders.map((f) => f.id));
  const activeFolder =
    folder === UNFILED || folder === RECENT || folderIds.has(folder) ? folder : ALL;
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const hasRecent = templates.some((t) => t.myLastUsed !== null);

  const query = q.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const effectiveSort: Sort = sort || (activeFolder === RECENT ? "recent" : "popular");

  // Everything that passes the search and filters, before the folder narrows it. Drives the
  // sidebar counts, so a search shows at a glance which folders hold matches.
  const matching = templates.filter((t) =>
    matchesFilters(
      t,
      { q, brand, type, mine },
      tokens,
      t.folderId ? (folderName.get(t.folderId) ?? "") : "",
      currentUserId,
    ),
  );

  const bySort = compare(effectiveSort);
  const visible = matching
    .filter((t) => inFolder(t, activeFolder))
    .sort(
      tokens.length > 0 && !sort
        ? (a, b) => nameScore(b, query, tokens) - nameScore(a, query, tokens) || bySort(a, b)
        : bySort,
    );

  const countIn = (f: string) => matching.filter((t) => inFolder(t, f)).length;
  const filtersActive = Boolean(q || brand || type || mine || sort);

  // Keep the view in the URL so it survives a refresh and can be sent to a teammate.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (activeFolder) p.set("folder", activeFolder);
    if (brand) p.set("brand", brand);
    if (type) p.set("type", type);
    if (mine) p.set("mine", "1");
    if (sort) p.set("sort", sort);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [q, activeFolder, brand, type, mine, sort]);

  // "/" jumps to search from anywhere on the page, as in most libraries.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function clearFilters() {
    setQ("");
    setBrand("");
    setType("");
    setMine(false);
    setSort("");
  }

  const elsewhere = visible.length === 0 && activeFolder !== ALL ? matching.length : 0;
  const currentFolder = folders.find((f) => f.id === activeFolder);
  const heading =
    activeFolder === ALL
      ? "All templates"
      : activeFolder === UNFILED
        ? "Unfiled"
        : activeFolder === RECENT
          ? "Recently used by me"
          : (currentFolder?.name ?? "");

  if (templates.length === 0) {
    return (
      <EmptyState
        title="No image templates yet"
        description="Save a repeatable creative direction so your team can generate consistent assets faster."
        action={
          <Button
            href="/images/templates/new"
            label="Create a template"
            variant="primary"
            size="sm"
          />
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <FolderNav
        folders={folders}
        active={activeFolder}
        onSelect={setFolder}
        countIn={countIn}
        hasRecent={hasRecent}
      />

      <div className="min-w-0 flex-1">
        {/* Search + filters */}
        <div className="flex flex-col gap-2">
          <div className="relative min-w-0">
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
            >
              <path
                fill="currentColor"
                d="M8.5 3a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64a.75.75 0 1 1-1.06 1.06l-3.64-3.65A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
              />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQ("");
              }}
              placeholder="Search name, description, prompt…"
              aria-label="Search templates"
              className={`${controlCls} w-full pr-8 pl-8 placeholder:text-zinc-400`}
            />
            {!q && (
              <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-zinc-200 px-1.5 font-mono text-[10px] text-zinc-400 sm:block">
                /
              </kbd>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              aria-label="Brand"
              className={controlCls}
            >
              <option value="">Any brand</option>
              <option value="global">All-brand only</option>
              {brands.length > 0 && (
                <optgroup label="Usable for (incl. all-brand)">
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Template type"
              className={controlCls}
            >
              <option value="">Any type</option>
              <option value="reference">With reference image</option>
              <option value="prompt">Prompt only</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort | "")}
              aria-label="Sort"
              className={controlCls}
            >
              <option value="">
                Sort: {tokens.length > 0 ? "Best match" : SORT_LABELS[effectiveSort]}
              </option>
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <label className="flex h-9 min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 text-zinc-800 max-md:min-h-11 select-none has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-zinc-50">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="sr-only"
              />
              Created by me
            </label>
          </div>
        </div>

        {/* Result header */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {currentFolder ? (
              <FolderHeading
                key={currentFolder.id}
                folder={currentFolder}
                count={visible.length}
                onDeleted={() => setFolder(ALL)}
              />
            ) : (
              <h2 className="text-sm font-medium text-zinc-800">
                {heading}{" "}
                <span className="font-normal text-zinc-500">({visible.length})</span>
              </h2>
            )}
            {filtersActive && (
              <Button label="Clear filters" variant="ghost" size="sm" onClick={clearFilters} />
            )}
          </div>
          <Button
            href={
              currentFolder
                ? `/images/templates/new?folder=${currentFolder.id}`
                : "/images/templates/new"
            }
            label="New template"
            variant="primary"
          />
        </div>

        {visible.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={
                activeFolder === RECENT && !filtersActive
                  ? "Nothing used yet"
                  : filtersActive
                    ? "No templates match"
                    : "This folder is empty"
              }
              description={
                activeFolder === RECENT && !filtersActive
                  ? "Templates you generate from show up here, most recent first."
                  : filtersActive
                    ? "Try fewer words or loosen a filter."
                    : "Move templates here with the folder menu on each card, or create one in this folder."
              }
              action={
                elsewhere > 0 ? (
                  <Button
                    label={`Show ${elsewhere} match${elsewhere === 1 ? "" : "es"} in other folders`}
                    variant="primary"
                    size="sm"
                    onClick={() => setFolder(ALL)}
                  />
                ) : filtersActive ? (
                  <Button label="Clear filters" size="sm" onClick={clearFilters} />
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {visible.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                folders={folders}
                isMine={t.createdById === currentUserId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderNav({
  folders,
  active,
  onSelect,
  countIn,
  hasRecent,
}: {
  folders: Option[];
  active: string;
  onSelect: (f: string) => void;
  countIn: (f: string) => number;
  hasRecent: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const unfiled = countIn(UNFILED);

  const item = (key: string, label: string, icon: "all" | "recent" | "folder" | "inbox") => {
    const n = countIn(key);
    const isActive = active === key;
    return (
      <Button
        key={key || "all"}
        label={label}
        variant={isActive ? "primary" : "ghost"}
        size="sm"
        onClick={() => onSelect(key)}
        aria-current={isActive ? "true" : undefined}
        icon={<NavIcon kind={icon} />}
        endContent={
          <span
            className={`text-xs tabular-nums ${isActive ? "text-zinc-300" : n === 0 ? "text-zinc-300" : "text-zinc-500"}`}
          >
            {n}
          </span>
        }
        className="shrink-0 justify-start lg:w-full"
      />
    );
  };

  return (
    <nav
      aria-label="Template folders"
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {item(ALL, "All templates", "all")}
      {hasRecent && item(RECENT, "Recently used", "recent")}

      <p className="mt-3 mb-1 hidden px-2.5 text-[0.7rem] font-medium tracking-wide text-zinc-400 uppercase lg:block">
        Folders
      </p>
      <span aria-hidden className="mx-1 w-px shrink-0 bg-zinc-200 lg:hidden" />
      {folders.map((f) => item(f.id, f.name, "folder"))}
      {(unfiled > 0 || active === UNFILED) && item(UNFILED, "Unfiled", "inbox")}

      {adding ? (
        <form
          action={async (fd) => {
            await createFolder(fd);
            setAdding(false);
          }}
          className="flex shrink-0 items-center gap-1 lg:mt-1"
        >
          <input
            name="name"
            required
            autoFocus
            maxLength={60}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
            }}
            className="h-8 w-40 min-w-0 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 lg:w-full"
          />
          <Button type="submit" label="Add" variant="primary" size="sm" />
        </form>
      ) : (
        <Button
          label="New folder"
          variant="ghost"
          size="sm"
          icon={<Icon icon={Plus} />}
          onClick={() => setAdding(true)}
          className="shrink-0 justify-start lg:mt-1 lg:w-full"
        />
      )}
    </nav>
  );
}

function FolderHeading({
  folder,
  count,
  onDeleted,
}: {
  folder: Option;
  count: number;
  onDeleted: () => void;
}) {
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <form
        action={async (fd) => {
          await renameFolder(fd);
          setRenaming(false);
        }}
        className="flex items-center gap-1.5"
      >
        <input type="hidden" name="id" value={folder.id} />
        <input
          name="name"
          required
          autoFocus
          maxLength={60}
          defaultValue={folder.name}
          aria-label="Folder name"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-8 w-48 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-500"
        />
        <Button type="submit" label="Save" variant="primary" size="sm" />
        <Button label="Cancel" variant="ghost" size="sm" onClick={() => setRenaming(false)} />
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <h2 className="truncate text-sm font-medium text-zinc-800">
        {folder.name} <span className="font-normal text-zinc-500">({count})</span>
      </h2>
      <Button label="Rename" variant="ghost" size="sm" onClick={() => setRenaming(true)} />
      <form
        action={async (fd) => {
          await deleteFolder(fd);
          onDeleted();
        }}
      >
        <input type="hidden" name="id" value={folder.id} />
        <ConfirmSubmitButton
          message={`Delete the folder “${folder.name}”? Its templates are kept and move to Unfiled.`}
          label="Delete folder"
        />
      </form>
    </div>
  );
}

function TemplateCard({
  template: t,
  folders,
  isMine,
}: {
  template: LibraryTemplate;
  folders: Option[];
  isMine: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const meta = [
    t.brandName ?? "All brands",
    t.referenceUrls.length > 0 &&
      `${t.referenceUrls.length} image${t.referenceUrls.length === 1 ? "" : "s"}`,
    t.uses > 0 && `used ${t.uses}×`,
    isMine ? "yours" : t.createdByName && `by ${t.createdByName}`,
  ].filter(Boolean);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      <Link href={`/images?template=${t.id}`} className="block" tabIndex={-1} aria-hidden>
        {t.referenceUrls[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.referenceUrls[0]}
            alt=""
            loading="lazy"
            className="aspect-square w-full object-cover"
          />
        ) : (
          // Prompt-only template: preview the prompt where the reference image would be.
          <div className="aspect-square w-full overflow-hidden bg-zinc-50 p-3 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
            <p className="font-mono text-[10px] leading-4 whitespace-pre-line text-zinc-500">
              {t.prompt}
            </p>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-900" title={t.name}>
            {t.name}
          </p>
          <p className="truncate text-xs text-zinc-500" title={meta.join(" · ")}>
            {meta.join(" · ")}
          </p>
          {t.description && (
            <p
              className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-600"
              title={t.description}
            >
              {t.description}
            </p>
          )}
        </div>

        <div className="mt-auto pt-1">
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
            <NavIcon kind="folder" />
            <span className="sr-only">Folder</span>
            <select
              value={t.folderId ?? ""}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value || null;
                startTransition(() => moveTemplate(t.id, next));
              }}
              className="min-w-0 flex-1 truncate rounded border-0 bg-transparent py-0.5 pr-5 text-xs text-zinc-600 hover:text-zinc-900 focus:ring-1 focus:ring-zinc-300 focus:outline-none"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-xs">
          <div className="flex items-center gap-2">
            <Button href={`/images?template=${t.id}`} label="Use" variant="primary" size="sm" />
            <Link
              href={`/images/templates/${t.id}`}
              className="text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              Edit
            </Link>
          </div>
          <form action={deleteTemplate}>
            <input type="hidden" name="id" value={t.id} />
            <ConfirmSubmitButton
              message={`Delete “${t.name}”? This cannot be undone.`}
              label="Delete"
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function NavIcon({ kind }: { kind: "all" | "recent" | "folder" | "inbox" }) {
  const paths: Record<typeof kind, string> = {
    all: "M3 4.5A1.5 1.5 0 0 1 4.5 3h3A1.5 1.5 0 0 1 9 4.5v3A1.5 1.5 0 0 1 7.5 9h-3A1.5 1.5 0 0 1 3 7.5v-3Zm8 0A1.5 1.5 0 0 1 12.5 3h3A1.5 1.5 0 0 1 17 4.5v3A1.5 1.5 0 0 1 15.5 9h-3A1.5 1.5 0 0 1 11 7.5v-3Zm-8 8A1.5 1.5 0 0 1 4.5 11h3A1.5 1.5 0 0 1 9 12.5v3A1.5 1.5 0 0 1 7.5 17h-3A1.5 1.5 0 0 1 3 15.5v-3Zm8 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z",
    recent:
      "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.75a.75.75 0 0 1 .75.75v2.69l1.78 1.78a.75.75 0 1 1-1.06 1.06l-2-2A.75.75 0 0 1 9.25 10V7a.75.75 0 0 1 .75-.75Z",
    folder:
      "M3 5.5A1.5 1.5 0 0 1 4.5 4h3.38a1.5 1.5 0 0 1 1.06.44L10.5 6h5A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9Zm1.5 0v9h11v-7H10.19a.75.75 0 0 1-.53-.22L7.88 5.5H4.5Z",
    inbox:
      "M5.2 4h9.6a1.5 1.5 0 0 1 1.37.89l1.7 3.82c.09.19.13.4.13.61v5.18A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5V9.32c0-.21.04-.42.13-.61l1.7-3.82A1.5 1.5 0 0 1 5.2 4Zm0 1.5L3.76 8.75H7a.75.75 0 0 1 .75.75 2.25 2.25 0 0 0 4.5 0A.75.75 0 0 1 13 8.75h3.24L14.8 5.5H5.2Z",
  };
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 opacity-70">
      <path fill="currentColor" fillRule="evenodd" d={paths[kind]} />
    </svg>
  );
}
