import { HelpCircle } from "lucide-react";

const STEPS = [
  ["Compose", "Pick the brands, write once, attach media from an upload or the image studio."],
  ["Publish or plan", "Publish now, schedule on Facebook, or put a day on the calendar for Instagram."],
  ["Facebook schedules, we do not", "Meta holds a scheduled Facebook post. Instagram has no such API, so a planned day is a reminder for you."],
  ["Drafts", "Anything waiting, failed, or half-published. A stuck publish can be finished without posting twice."],
  ["Posts", "Every post that went out, with its numbers. Facebook has no reach; it is absent, not zero."],
  ["Ask the agent", "It drafts into your queue. It never publishes."],
];

/**
 * Six lines about how the surface works, open only when there is nothing to
 * look at. Once there is real work on the page it gets out of the way.
 */
export function HowThisWorks({ open = false }: { open?: boolean }) {
  return (
    <details
      open={open}
      className="group mb-6 rounded-xl border border-zinc-200 bg-white p-3 shadow-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-zinc-700">
        <HelpCircle className="size-3.5 text-zinc-400" />
        How this works
      </summary>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex gap-2">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[0.6rem] font-medium tabular-nums text-zinc-500">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[0.7rem] font-medium text-zinc-800">{title}</span>
              <span className="block text-[0.7rem] leading-4 text-zinc-500">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
