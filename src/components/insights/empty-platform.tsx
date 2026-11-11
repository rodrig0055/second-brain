import Link from "next/link";
import type { InsightPlatform } from "@/lib/insights/platforms";
import type { PlatformData } from "@/lib/insights/data";

/**
 * Section shown when a platform has no rows in the window. Distinguishes "never
 * connected" from "connected, but nothing in this range" so the message is
 * actionable. Admins get a link to wire it up.
 */
export function EmptyPlatform({
  spec,
  data,
  isAdmin,
}: {
  spec: InsightPlatform;
  data?: PlatformData;
  isAdmin: boolean;
}) {
  const connected =
    data?.connection && data.connection.status !== "disconnected";
  const message = connected
    ? "No data in this range yet."
    : "Not connected.";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            connected ? "bg-zinc-400" : "bg-transparent ring-1 ring-inset ring-zinc-300"
          }`}
          aria-hidden
        />
        <span className="text-sm text-zinc-600">{spec.label}</span>
        <span className="ml-auto text-[0.7rem] text-zinc-400">{message}</span>
        {!connected && isAdmin && (
          <Link
            href="/admin/integrations"
            className="text-[0.7rem] text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
          >
            Connect
          </Link>
        )}
      </div>
    </div>
  );
}
