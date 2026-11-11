import { platform, type PlatformKey } from "@/lib/social/platforms";

const SIZES = {
  xs: { tile: "size-4 rounded", icon: "size-2.5", text: "text-[0.5rem]" },
  sm: { tile: "size-5 rounded-md", icon: "size-3", text: "text-[0.55rem]" },
  md: { tile: "size-8 rounded-lg", icon: "size-4", text: "text-xs" },
  lg: { tile: "size-10 rounded-lg", icon: "size-5", text: "text-sm" },
} as const;

/**
 * A platform's logo on its brand colour. The tile, not the bare glyph, is what
 * makes a list of mixed platforms scannable.
 */
export function PlatformIcon({
  name,
  size = "sm",
  muted = false,
  className = "",
}: {
  name: PlatformKey;
  size?: keyof typeof SIZES;
  /** Greyed, for a platform that is not connected. */
  muted?: boolean;
  className?: string;
}) {
  const p = platform(name);
  const s = SIZES[size];
  return (
    <span
      role="img"
      aria-label={p.label}
      title={p.label}
      style={{ backgroundColor: muted ? undefined : p.color }}
      className={`inline-flex shrink-0 items-center justify-center ${s.tile} ${
        muted ? "bg-zinc-200 text-zinc-500" : "text-white"
      } ${className}`}
    >
      {p.path ? (
        <svg viewBox="0 0 24 24" aria-hidden className={`${s.icon} fill-current`}>
          <path d={p.path} />
        </svg>
      ) : (
        <span className={`font-bold leading-none ${s.text}`}>{p.letter}</span>
      )}
    </span>
  );
}
