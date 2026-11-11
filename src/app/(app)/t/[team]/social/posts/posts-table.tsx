"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Drawer } from "@/components/ui/drawer";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { brandTone } from "@/lib/brand-tone";
import { PlatformIcon } from "@/components/platform-icon";
import type { SocialPostRow } from "@/lib/social/metrics";

/**
 * Every post that went out, across the brands in scope.
 *
 * Facebook's reach column reads "n/a", not 0. The metric does not exist on this
 * API version, and a zero in a column people sort by would put every Facebook
 * post at the bottom of a "worst reach" sort as though it had failed.
 */

function n(v: number | null): string {
  return v === null ? "n/a" : v.toLocaleString("en-PH");
}

/** Meta's enum names, as people say them. Unknown values pass through. */
const MEDIA_LABELS: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REELS: "Reel",
};

function mediaLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return MEDIA_LABELS[type] ?? type;
}

const NA = <span className="text-zinc-300" title="Facebook does not report this">n/a</span>;

export function PostsTable({ rows, multiBrand }: { rows: SocialPostRow[]; multiBrand: boolean }) {
  const [open, setOpen] = useState<SocialPostRow | null>(null);

  const columns: DataTableColumn<SocialPostRow>[] = [
    {
      key: "date",
      label: "Date",
      value: (r) => r.date,
      align: "left",
      lockVisible: true,
      width: 112,
      render: (r) => <span className="whitespace-nowrap tabular-nums">{r.date}</span>,
    },
    ...(multiBrand
      ? ([
          {
            key: "brand",
            label: "Brand",
            value: (r) => r.brandName,
            align: "left" as const,
            render: (r) => (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={`size-1.5 rounded-full ${brandTone(r.brandSlug).dot}`} />
                {r.brandName}
              </span>
            ),
          },
        ] as DataTableColumn<SocialPostRow>[])
      : []),
    {
      key: "channel",
      label: "Channel",
      value: (r) => (r.channel === "instagram" ? "Instagram" : "Facebook"),
      align: "left",
      width: 112,
      render: (r) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <PlatformIcon name={r.channel === "instagram" ? "instagram" : "facebook"} size="xs" />
          {r.channel === "instagram" ? "Instagram" : "Facebook"}
        </span>
      ),
    },
    { key: "mediaType", label: "Type", value: (r) => mediaLabel(r.mediaType), align: "left" },
    {
      key: "caption",
      wide: true,
      label: "Caption",
      value: (r) => r.caption,
      align: "left",
      searchable: true,
      render: (r) => (
        <span className="block max-w-xs truncate" title={r.caption}>
          {r.caption || <span className="text-zinc-300">(no caption)</span>}
        </span>
      ),
    },
    {
      key: "reach",
      label: "Reach",
      value: (r) => r.reach,
      numeric: true,
      render: (r) => (r.reach === null ? NA : r.reach.toLocaleString("en-PH")),
    },
    {
      key: "engagementRate",
      label: "Eng. rate",
      value: (r) => (r.engagementRate ? parseFloat(r.engagementRate) : null),
      numeric: true,
      format: (v) => `${Number(v).toFixed(2)}%`,
      render: (r) =>
        r.engagementRate ?? (r.channel === "facebook" ? NA : <span className="text-zinc-300">—</span>),
    },
    { key: "engagement", label: "Engagement", value: (r) => r.engagement, numeric: true },
    { key: "likes", label: "Likes", value: (r) => r.likes, numeric: true, defaultVisible: false },
    { key: "comments", label: "Comments", value: (r) => r.comments, numeric: true, defaultVisible: false },
    { key: "shares", label: "Shares", value: (r) => r.shares, numeric: true, defaultVisible: false },
    { key: "saves", label: "Saves", value: (r) => r.saves, numeric: true, defaultVisible: false },
    {
      key: "clicks",
      label: "Clicks",
      value: (r) => r.clicks,
      numeric: true,
      defaultVisible: false,
      render: (r) => (r.clicks === null ? NA : r.clicks.toLocaleString("en-PH")),
    },
    {
      key: "videoViews",
      label: "Video views",
      value: (r) => r.videoViews,
      numeric: true,
      defaultVisible: false,
      render: (r) => (r.videoViews === null ? NA : r.videoViews.toLocaleString("en-PH")),
    },
    {
      key: "profileVisits",
      label: "Profile visits",
      value: (r) => r.profileVisits,
      numeric: true,
      defaultVisible: false,
      render: (r) =>
        r.profileVisits === null ? (
          <span className="text-zinc-300" title="Not reported for this post type">
            —
          </span>
        ) : (
          r.profileVisits.toLocaleString("en-PH")
        ),
    },
    {
      key: "source",
      label: "Source",
      value: (r) => (r.draftId ? "In app" : "Elsewhere"),
      align: "left",
      defaultVisible: false,
    },
  ];

  return (
    <>
      <DataTable
        id="social-posts"
        label="Social posts"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.dimensionKey}
        defaultSort={{ key: "date", dir: "desc" }}
        search={{ placeholder: "Search captions" }}
        onRowClick={setOpen}
        activeKey={open?.dimensionKey}
        csv={{ filename: "social-posts" }}
        emptyLabel="No posts published in this window."
        footnote="Facebook reports no reach or engagement rate on this API version. Those columns read n/a rather than zero."
      />
      {open && <PostDrawer post={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PostDrawer({ post, onClose }: { post: SocialPostRow; onClose: () => void }) {
  const isFacebook = post.channel === "facebook";
  const stats: { label: string; value: string }[] = [
    { label: "Reach", value: n(post.reach) },
    { label: "Engagement", value: post.engagement.toLocaleString("en-PH") },
    { label: "Engagement rate", value: post.engagementRate ?? "n/a" },
    { label: "Likes", value: post.likes.toLocaleString("en-PH") },
    { label: "Comments", value: post.comments.toLocaleString("en-PH") },
    { label: "Shares", value: post.shares.toLocaleString("en-PH") },
    ...(isFacebook
      ? [
          { label: "Clicks", value: n(post.clicks) },
          { label: "Video views", value: n(post.videoViews) },
        ]
      : [
          { label: "Saves", value: post.saves.toLocaleString("en-PH") },
          { label: "Profile visits", value: n(post.profileVisits) },
        ]),
  ];

  return (
    <Drawer label={`${post.brandName} ${post.channel === "instagram" ? "Instagram" : "Facebook"} post, ${post.date}`} onClose={onClose}>
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
            <span className={`size-1.5 rounded-full ${brandTone(post.brandSlug).dot}`} />
            {post.brandName}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {post.channel === "instagram" ? "Instagram" : "Facebook Page"} · {post.date} ·{" "}
            {post.mediaType || "post"}
          </p>
        </div>
        <IconButton
          label="Close"
          icon={<Icon icon={X} />}
          variant="ghost"
          size="sm"
          onClick={onClose}
        />
      </header>

      <div className="space-y-4 p-4">
        {post.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.mediaUrl}
            alt=""
            className="max-h-64 w-full rounded-lg object-cover ring-1 ring-zinc-200"
          />
        )}

        <p className="whitespace-pre-wrap text-sm text-zinc-700">
          {post.caption || <span className="text-zinc-400">(no caption)</span>}
        </p>

        <dl className="grid grid-cols-3 gap-3 border-t border-zinc-100 pt-3">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[0.65rem] text-zinc-500">{s.label}</dt>
              <dd
                className={`text-sm font-medium tabular-nums ${
                  s.value === "n/a" ? "text-zinc-300" : "text-zinc-900"
                }`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        {post.reactions && Object.keys(post.reactions).length > 0 && (
          <div className="border-t border-zinc-100 pt-3">
            <p className="mb-1.5 text-[0.65rem] text-zinc-500">Reactions</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(post.reactions).map(([kind, count]) => (
                <span
                  key={kind}
                  className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.7rem] tabular-nums text-zinc-700"
                >
                  {kind} {count}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
          {post.permalink && (
            <Button
              label="Open post"
              size="sm"
              icon={<Icon icon={ExternalLink} />}
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
            />
          )}
          <Button
            label="Draft a variation"
            variant="primary"
            size="sm"
            href={`/t/social-media/social/compose?from=${encodeURIComponent(post.dimensionKey)}&brand=${post.brandId}`}
          />
        </div>

        <p className="text-[0.65rem] text-zinc-400">
          {post.draftId
            ? "Published from this app."
            : "Published outside this app; the sync picked it up."}
        </p>
      </div>
    </Drawer>
  );
}
