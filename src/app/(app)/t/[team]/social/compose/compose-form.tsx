"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Send,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Spinner } from "@astryxdesign/core/Spinner";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { uploadFromBrowser } from "@/lib/storage/browser-upload";

import { brandTone } from "@/lib/brand-tone";
import {
  CAPTION_LIMIT,
  HASHTAG_LIMIT,
  countHashtags,
  draftWarnings,
  validateDraft,
} from "@/lib/social/validate";
import { classifyUrl } from "@/lib/social/media-rules";
import { PlatformIcon } from "@/components/platform-icon";
import { createDrafts, type SocialActionState } from "../actions";
import type { PickerItem } from "@/lib/social/media";

/**
 * Write a post once, for as many brands as you run.
 *
 * Each brand becomes its own draft row rather than one row with several
 * targets: each gets its own media id, its own numbers, and can fail on its
 * own. Validation runs while you type, because the alternative is finding out
 * from Meta after you press publish.
 *
 * Laid out as content on the left (where to post, what to say, what to show)
 * and outcome on the right (when it goes out, what it will look like). The
 * actions sit in a footer that never scrolls away: pinned to the side panel,
 * or at the bottom of the page when opened on its own.
 */

export type ComposeBrand = {
  id: string;
  name: string;
  slug: string;
  igUserId: string;
  connectionStatus: string;
};

type Mode = "draft" | "now" | "schedule";

const EMPTY: SocialActionState = {};

const MODES: { key: Mode; label: string; icon: ReactNode }[] = [
  { key: "draft", label: "Draft", icon: <Icon icon={FileText} /> },
  { key: "now", label: "Now", icon: <Icon icon={Send} /> },
  { key: "schedule", label: "Schedule", icon: <Icon icon={CalendarClock} /> },
];

export function ComposeForm({
  teamSlug,
  brands,
  picker,
  initial,
  shell,
  onCancel,
}: {
  teamSlug: string;
  brands: ComposeBrand[];
  picker: PickerItem[];
  initial?: {
    brandIds?: string[];
    caption?: string;
    mediaUrls?: string[];
    channel?: string;
    mediaType?: string;
    plannedFor?: string;
  };
  /**
   * Wraps the form body and its footer. The side panel passes one that pins
   * the footer to the panel; without it the footer sticks to the page bottom.
   */
  shell?: (body: ReactNode, footer: ReactNode) => ReactNode;
  onCancel?: () => void;
}) {
  const [state, submit, pending] = useActionState(createDrafts, EMPTY);

  const [selected, setSelected] = useState<string[]>(
    initial?.brandIds?.length ? initial.brandIds : brands[0] ? [brands[0].id] : [],
  );
  const initialChannel = initial?.channel ?? "instagram";
  const [onInstagram, setOnInstagram] = useState(initialChannel !== "facebook");
  const [onFacebook, setOnFacebook] = useState(initialChannel !== "instagram");
  const channel = onInstagram && onFacebook ? "both" : onFacebook ? "facebook" : "instagram";

  const [mediaType, setMediaType] = useState(initial?.mediaType ?? "image");
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [media, setMedia] = useState<string[]>(initial?.mediaUrls ?? []);
  const [firstComment, setFirstComment] = useState("");
  const [altText, setAltText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [plannedFor, setPlannedFor] = useState(initial?.plannedFor ?? "");
  const [scheduleAt, setScheduleAt] = useState("");
  const [mode, setMode] = useState<Mode>("draft");
  const [tab, setTab] = useState<"upload" | "pick" | "url">("upload");
  const [urlDraft, setUrlDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const igSelected = selected
    .map((id) => brands.find((b) => b.id === id))
    .filter((b): b is ComposeBrand => Boolean(b));
  const withoutInstagram = igSelected.filter((b) => !b.igUserId);
  const igBlocked = channel !== "facebook" && withoutInstagram.length > 0;

  // Validated against the strictest selected brand, so a post that would fail
  // for one of three brands says so before it is queued.
  const shape = {
    channel: channel as "instagram" | "facebook" | "both",
    mediaType,
    caption,
    mediaUrls: media,
    linkUrl,
    firstComment,
  };
  const problem =
    selected.length === 0
      ? "Pick at least one brand."
      : !caption.trim() && media.length === 0
        ? "A post needs a caption or some media."
        : validateDraft(shape, {
            igUserId: igSelected.every((b) => b.igUserId) ? "ok" : "",
          });

  const warnings = draftWarnings(shape);
  const hashtags = countHashtags(caption) + countHashtags(firstComment);

  // Instagram has no scheduling API. Facebook does, and holds the post itself.
  const canSchedule = channel !== "instagram";
  const modeBlocked =
    mode === "schedule" && !canSchedule
        ? "Instagram cannot be scheduled through its API. Turn on Facebook, or plan a day as a draft."
        : mode === "schedule" && !scheduleAt
          ? "Pick when it should go out."
          : null;

  const intent = mode === "now" ? "publish" : mode === "schedule" ? "schedule" : "save";
  const primaryLabel = pending
    ? "Working…"
    : mode === "now"
      ? selected.length > 1
        ? `Publish to ${selected.length} brands`
        : "Publish now"
      : mode === "schedule"
        ? "Schedule"
        : selected.length > 1
          ? `Save ${selected.length} drafts`
          : "Save draft";

  const done = Boolean(state.ok) && !state.results?.some((r) => r.error);

  async function handleFiles(files: FileList | null) {
    if (!files?.length || selected.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const images = [...files].filter((f) => f.type.startsWith("image/"));
      const videos = [...files].filter((f) => f.type.startsWith("video/"));

      if (images.length) {
        const body = new FormData();
        body.set("brandId", selected[0]);
        for (const f of images) body.append("files", f);
        const res = await fetch("/api/social/media", { method: "POST", body });
        const json = (await res.json()) as { media?: { url: string }[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Upload failed.");
        setMedia((m) => [...m, ...(json.media ?? []).map((x) => x.url)]);
      }

      // Video goes straight to storage: a function body caps at 4.5 MB and a
      // Reel is bigger than that.
      for (const file of videos) {
        const { url } = await uploadFromBrowser(`social/${file.name}`, file, {
          handleUploadUrl: "/api/social/upload-token",
        });
        setMedia((m) => [...m, url]);
        setMediaType("video");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function toggleBrand(id: string) {
    setSelected((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]));
  }

  const formId = "compose-form";

  const footer = (
    <>
      <div className="min-w-0 flex-1 text-xs">
        {state.error ? (
          <p className="text-red-600">{state.error}</p>
        ) : done ? (
          <p className="flex items-center gap-1.5 text-emerald-700">
            <Check className="size-3.5" />
            {state.ok}
          </p>
        ) : problem ? (
          <p className="text-zinc-500">{problem}</p>
        ) : modeBlocked ? (
          <p className="text-zinc-500">{modeBlocked}</p>
        ) : (
          <p className="text-zinc-400">
            {selected.length > 1
              ? `${selected.length} separate posts, one per brand.`
              : "Ready."}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onCancel && (
          <Button label={done ? "Close" : "Cancel"} onClick={onCancel} />
        )}
        <Button
          label={primaryLabel}
          variant="primary"
          type="submit"
          form={formId}
          name="intent"
          value={intent}
          isDisabled={pending || Boolean(problem) || Boolean(modeBlocked)}
          icon={pending ? <Spinner size="sm" shade="inherit" /> : undefined}
        />
      </div>
    </>
  );

  const body = (
      <form id={formId} action={submit} className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
        <input type="hidden" name="teamSlug" value={teamSlug} />
        {selected.map((id) => (
          <input key={id} type="hidden" name="brandIds" value={id} />
        ))}
        <input type="hidden" name="mediaUrls" value={media.join("\n")} />
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="mediaType" value={mediaType} />
        {mode === "draft" && <input type="hidden" name="plannedFor" value={plannedFor} />}
        {mode === "schedule" && <input type="hidden" name="scheduleAt" value={scheduleAt} />}

        {/* Content */}
        <div className="grid content-start gap-6 p-6">
          <Section title="Post to">
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {brands.map((b) => {
                  const on = selected.includes(b.id);
                  return (
                    <ToggleButton
                      key={b.id}
                      label={b.name}
                      size="sm"
                      isPressed={on}
                      onPressedChange={() => toggleBrand(b.id)}
                      icon={
                        <span
                          className={`size-2 rounded-full ${on ? "bg-current opacity-70" : brandTone(b.slug).dot}`}
                        />
                      }
                    >
                      {b.name}
                    </ToggleButton>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ChannelToggle
                  on={onInstagram}
                  icon={<PlatformIcon name="instagram" size="md" muted={!onInstagram} />}
                  label="Instagram"
                  detail="Feed, Reels, carousels"
                  onClick={() => {
                    if (onInstagram && !onFacebook) return;
                    setOnInstagram(!onInstagram);
                  }}
                />
                <ChannelToggle
                  on={onFacebook}
                  icon={<PlatformIcon name="facebook" size="md" muted={!onFacebook} />}
                  label="Facebook Page"
                  detail="Posts, links, scheduling"
                  onClick={() => {
                    if (onFacebook && !onInstagram) return;
                    setOnFacebook(!onFacebook);
                  }}
                />
              </div>

              {igBlocked && (
                <Note tone="warn">
                  No Instagram account linked for {withoutInstagram.map((b) => b.name).join(", ")}.
                  Post to Facebook only, or drop that brand.
                </Note>
              )}
            </div>
          </Section>

          <Section
            title="Content"
            aside={
              <select
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value)}
                aria-label="Media type"
                className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-xs text-zinc-700"
              >
                <option value="image">Image</option>
                <option value="video">Video / Reel</option>
                <option value="carousel">Carousel</option>
                <option value="text">Text (Facebook only)</option>
              </select>
            }
          >
            <textarea
              name="caption"
              rows={7}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Lead with the hook. Only the first 125 characters show before the fold."
              className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-6 text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
            />
            <div className="mt-1.5 flex flex-wrap justify-end gap-3 text-[0.7rem] tabular-nums text-zinc-400">
              {caption.length > 125 && <span>hook ends at 125</span>}
              <span className={hashtags > HASHTAG_LIMIT ? "text-red-600" : ""}>
                {hashtags} hashtag{hashtags === 1 ? "" : "s"}
              </span>
              <span className={caption.length > CAPTION_LIMIT ? "text-red-600" : ""}>
                {caption.length}/{CAPTION_LIMIT}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {onInstagram && (
                <Field label="First comment" hint="Instagram. Hashtags often read better here.">
                  <textarea
                    name="firstComment"
                    rows={2}
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    placeholder="#flowers #manila"
                    className="w-full rounded-lg border border-zinc-200 p-2.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400"
                  />
                </Field>
              )}
              <Field label="Alt text" hint="Read aloud to people using a screen reader.">
                <input
                  name="altText"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="A bouquet of red roses on a white table"
                  className="h-9 w-full rounded-lg border border-zinc-200 px-2.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400"
                />
              </Field>
              {onFacebook && (
                <Field label="Link" hint="Facebook only. Shows as a link card.">
                  <input
                    name="linkUrl"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://bloomly-ph.example/…"
                    className="h-9 w-full rounded-lg border border-zinc-200 px-2.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400"
                  />
                </Field>
              )}
            </div>
          </Section>

          <Section
            title="Media"
            aside={uploading ? <Loader2 className="size-3.5 animate-spin text-zinc-400" /> : null}
          >
            <SegmentedControl
              label="Media source"
              size="sm"
              value={tab}
              onChange={(v) => setTab(v as typeof tab)}
              className="mb-2"
            >
              {(["upload", "pick", "url"] as const).map((t) => (
                <SegmentedControlItem
                  key={t}
                  value={t}
                  label={t === "upload" ? "Upload" : t === "pick" ? "From this app" : "Paste a URL"}
                />
              ))}
            </SegmentedControl>

            {tab === "upload" && (
              <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 px-4 py-7 text-center hover:border-zinc-400">
                <Upload className="size-5 text-zinc-400" />
                <span className="text-sm text-zinc-700">Drop images or a video, or click to browse</span>
                <span className="text-[0.7rem] text-zinc-400">
                  Images are converted to JPEG, which is all Instagram accepts.
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
            )}

            {tab === "pick" && (
              <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                {picker.length === 0 && (
                  <p className="col-span-full text-xs text-zinc-400">
                    Nothing in the image studio or brand assets for this brand yet.
                  </p>
                )}
                {picker.map((item) => (
                  <Tooltip key={item.url} content={item.label} hasHoverIndication={false}>
                    <ClickableCard
                      label={item.label}
                      padding={0}
                      onClick={() => setMedia((m) => (m.includes(item.url) ? m : [...m, item.url]))}
                      className="aspect-square overflow-hidden"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img loading="lazy" decoding="async" src={item.url} alt={item.label} className="size-full object-cover" />
                    </ClickableCard>
                  </Tooltip>
                ))}
              </div>
            )}

            {tab === "url" && (
              <div className="flex gap-2">
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://…"
                  className="h-9 flex-1 rounded-lg border border-zinc-200 px-2.5 text-xs outline-none focus:border-zinc-400"
                />
                <Button
                  label="Add"
                  icon={<Icon icon={Link2} />}
                  onClick={() => {
                    if (urlDraft.trim()) setMedia((m) => [...m, urlDraft.trim()]);
                    setUrlDraft("");
                  }}
                />
              </div>
            )}

            {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}

            {media.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {media.map((url, i) => (
                  <span key={`${url}-${i}`} className="group relative">
                    {classifyUrl(url) === "video" ? (
                      <span className="flex size-16 items-center justify-center rounded-md bg-zinc-100 text-[0.65rem] text-zinc-500 ring-1 ring-zinc-200">
                        video
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="size-16 rounded-md object-cover ring-1 ring-zinc-200" />
                    )}
                    <IconButton
                      label="Remove"
                      icon={<Icon icon={X} />}
                      variant="primary"
                      size="sm"
                      onClick={() => setMedia((m) => m.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    />
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Outcome */}
        <aside className="grid content-start gap-6 border-t border-zinc-200 bg-zinc-50/60 p-6 lg:border-l lg:border-t-0">
          <Section title="Publishing">
            <SegmentedControl
              label="Publishing"
              layout="fill"
              size="sm"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
            >
              {MODES.map((m) => (
                <SegmentedControlItem key={m.key} value={m.key} label={m.label} icon={m.icon} />
              ))}
            </SegmentedControl>

            <div className="mt-3">
              {mode === "draft" && (
                <Field label="Plan a day" hint="Optional. Shows on the calendar; nothing publishes it.">
                  <input
                    type="date"
                    value={plannedFor}
                    onChange={(e) => setPlannedFor(e.target.value)}
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-xs"
                  />
                </Field>
              )}
              {mode === "now" && (
                <p className="text-xs leading-5 text-zinc-500">
                  Goes out as soon as you press publish, to every brand and channel selected.
                </p>
              )}
              {mode === "schedule" &&
                (canSchedule ? (
                  <Field
                    label="Date and time"
                    hint={
                      channel === "both"
                        ? "Facebook is held by Meta. The Instagram half becomes a draft planned for that day."
                        : "Meta holds the post and publishes it. 10 minutes to 75 days out, Manila time."
                    }
                  >
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-xs"
                    />
                  </Field>
                ) : (
                  <Note tone="warn">
                    Instagram cannot be scheduled through its API. Turn on Facebook, or save a
                    draft with a planned day.
                  </Note>
                ))}
            </div>
          </Section>

          <Section title="Preview">
            <Preview channel={channel} caption={caption} media={media} />
          </Section>

          {(warnings.length > 0 || (state.results && state.results.length > 0)) && (
            <div className="grid gap-1.5">
              {warnings.map((w) => (
                <Note key={w.field + w.message} tone="warn">
                  {w.message}
                </Note>
              ))}
              {state.results?.map((r) => (
                <p key={r.brandName + r.draftId} className="text-xs text-zinc-600">
                  <span className="font-medium">{r.brandName}:</span> {r.error ?? r.status}
                  {r.permalink && (
                    <>
                      {" "}
                      <a href={r.permalink} target="_blank" rel="noreferrer" className="underline">
                        view
                      </a>
                    </>
                  )}
                </p>
              ))}
              {done && (
                <Link href={`/t/${teamSlug}/social/drafts`} className="text-xs font-medium text-zinc-900 underline">
                  Open drafts
                </Link>
              )}
            </div>
          )}
        </aside>
      </form>
  );

  if (shell) return <>{shell(body, footer)}</>;

  return (
    <>
      {body}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-3.5">
        {footer}
      </div>
    </>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.7rem] leading-4 text-zinc-400">{hint}</span>}
    </label>
  );
}

function Note({ tone, children }: { tone: "warn" | "neutral"; children: ReactNode }) {
  return (
    <p
      className={`rounded-lg px-3 py-2 text-xs leading-5 ${
        tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {children}
    </p>
  );
}

function ChannelToggle({
  on,
  icon,
  label,
  detail,
  onClick,
}: {
  on: boolean;
  icon: ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <SelectableCard label={label} isSelected={on} onChange={onClick} padding={2}>
      <span className="flex items-center gap-3 text-left">
        {icon}
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${on ? "text-zinc-900" : "text-zinc-500"}`}>{label}</span>
          <span className="block truncate text-[0.7rem] text-zinc-400">{detail}</span>
        </span>
        <span
          className={`flex size-4 items-center justify-center rounded border ${
            on ? "border-zinc-900 bg-zinc-900 text-zinc-50" : "border-zinc-300"
          }`}
        >
          {on && <Check className="size-3" />}
        </span>
      </span>
    </SelectableCard>
  );
}

/**
 * What it will look like. Instagram crops to 4:5 and 1:1, Facebook does not, so
 * the preview shows the crop rather than the original.
 */
function Preview({
  channel,
  caption,
  media,
}: {
  channel: string;
  caption: string;
  media: string[];
}) {
  const first = media[0];
  const shown = caption.slice(0, 125);
  const rest = caption.slice(125);

  return (
    <div className="grid gap-3">
      {channel !== "facebook" && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[0.7rem] text-zinc-500">
            <PlatformIcon name="instagram" size="xs" /> Instagram, 4:5
          </p>
          <div className="overflow-hidden rounded-lg bg-white ring-1 ring-zinc-200">
            {first ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={first} alt="" className="aspect-[4/5] w-full object-cover" />
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center bg-zinc-50 text-zinc-300">
                <ImagePlus className="size-5" />
              </div>
            )}
          </div>
        </div>
      )}
      {channel !== "instagram" && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[0.7rem] text-zinc-500">
            <PlatformIcon name="facebook" size="xs" /> Facebook feed
          </p>
          <div className="overflow-hidden rounded-lg bg-white ring-1 ring-zinc-200">
            {first ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={first} alt="" className="aspect-[1.91/1] w-full object-cover" />
            ) : (
              <div className="flex aspect-[1.91/1] items-center justify-center bg-zinc-50 text-zinc-300">
                <ImagePlus className="size-5" />
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs leading-5 text-zinc-700">
        {shown || <span className="text-zinc-300">Your caption appears here.</span>}
        {rest && <span className="text-zinc-400"> … more</span>}
      </p>
    </div>
  );
}
