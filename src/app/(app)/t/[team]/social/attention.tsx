import Link from "next/link";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";

import { brandTone } from "@/lib/brand-tone";
import type { Attention } from "@/lib/social/drafts";
import { socialPath } from "@/lib/social/access";

/**
 * What needs a person, above everything else on the page.
 *
 * Three things qualify: a post that failed, a publish that stalled halfway, and
 * what is going out in the next fortnight. Everything else on Overview is
 * information; this is the part that is a to-do.
 */
export function AttentionStrip({ attention }: { attention: Attention }) {
  const { failed, stalled, upcoming } = attention;
  if (failed.length === 0 && stalled.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {failed.length > 0 && (
        <Card
          tone="alert"
          icon={<AlertTriangle className="size-3.5" />}
          title={`${failed.length} failed to publish`}
          href={socialPath("drafts", { status: "failed" })}
        >
          {failed.slice(0, 3).map((d) => (
            <Line key={d.id} slug={d.brandSlug} text={d.caption || "(no caption)"} note={d.error ?? ""} />
          ))}
        </Card>
      )}

      {stalled.length > 0 && (
        <Card
          tone="alert"
          icon={<Loader2 className="size-3.5" />}
          title={`${stalled.length} stuck mid-publish`}
          href={socialPath("drafts", { status: "publishing" })}
        >
          <p className="text-[0.7rem] text-zinc-500">
            Publishing started and did not finish. Opening one offers to finish it without
            posting twice.
          </p>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card
          tone="calm"
          icon={<CalendarClock className="size-3.5" />}
          title={`${upcoming.length} coming up`}
          href={socialPath("calendar")}
        >
          {upcoming.slice(0, 3).map((d) => (
            <Line
              key={d.id}
              slug={d.brandSlug}
              text={d.caption || "(no caption)"}
              note={
                d.status === "scheduled"
                  ? `Facebook holds it${d.scheduledAt ? ` · ${d.scheduledAt.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : ""}`
                  : `Planned${d.plannedFor ? ` · ${d.plannedFor}` : ""}`
              }
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function Card({
  tone,
  icon,
  title,
  href,
  children,
}: {
  tone: "alert" | "calm";
  icon: React.ReactNode;
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-3 shadow-card hover:border-zinc-300 ${
        tone === "alert" ? "border-red-200 bg-red-50/40" : "border-zinc-200 bg-white"
      }`}
    >
      <p
        className={`flex items-center gap-1.5 text-xs font-medium ${
          tone === "alert" ? "text-red-700" : "text-zinc-800"
        }`}
      >
        {icon}
        {title}
      </p>
      <div className="mt-2 space-y-1">{children}</div>
    </Link>
  );
}

function Line({ slug, text, note }: { slug: string; text: string; note: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`size-1.5 shrink-0 rounded-full ${brandTone(slug).dot}`} />
      <span className="min-w-0 flex-1 truncate text-[0.7rem] text-zinc-700">{text}</span>
      {note && <span className="shrink-0 truncate text-[0.65rem] text-zinc-400">{note}</span>}
    </div>
  );
}
