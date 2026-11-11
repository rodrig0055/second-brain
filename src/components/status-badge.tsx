import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";

import { TONE_COLOR, statusInfo, type StatusTone } from "@/lib/status";

/**
 * A status as a small coloured token. The colour comes from the one status map
 * in `lib/status.ts`, so the same word reads the same everywhere.
 */
export function StatusBadge({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  /** Only where a surface means something else by the same word (a newsletter draft waits on no one). */
  tone?: StatusTone;
}) {
  const info = statusInfo(status);
  return <Token size="sm" color={TONE_COLOR[tone ?? info.tone]} label={label ?? info.label} />;
}

/**
 * A short tag with an explicit tone, for labels that are not a stored status:
 * "linked", "responded", "No data", a creative's angle. `tooltip` explains it
 * on hover and focus; `href` makes the tag a link.
 */
export function ToneTag({
  tone = "neutral",
  label,
  tooltip,
  href,
}: {
  tone?: StatusTone;
  label: string;
  tooltip?: string;
  href?: string;
}) {
  const token = <Token size="sm" color={TONE_COLOR[tone]} label={label} href={href} />;
  return tooltip ? <Tooltip content={tooltip}>{token}</Tooltip> : token;
}
