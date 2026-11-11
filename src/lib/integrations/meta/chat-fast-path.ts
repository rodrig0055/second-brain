import {
  META_DATE_PRESETS,
  type MetaDatePreset,
  type MetaDateSelection,
} from "./cli-report";

const META_ID_RE = /\b\d{12,20}\b/g;
const METRIC_INTENT_RE =
  /\b(spend|purchase|conversion|value|cir|ctr|landing page|lpv|roas|campaign id|ad set id|adset id|performance|metric|results?)\b/i;

function datePreset(text: string): MetaDatePreset | null {
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const candidates: [RegExp, MetaDatePreset][] = [
    [/\byesterday\b/, "yesterday"],
    [/\btoday\b/, "today"],
    [/\blast\s+3\s+days?\b/, "last_3d"],
    [/\blast\s+7\s+days?\b|\blast\s+week\b/, "last_7d"],
    [/\blast\s+14\s+days?\b/, "last_14d"],
    [/\blast\s+30\s+days?\b/, "last_30d"],
    [/\blast\s+90\s+days?\b/, "last_90d"],
    [/\bthis\s+month\b/, "this_month"],
    [/\blast\s+month\b/, "last_month"],
  ];
  for (const [pattern, value] of candidates) {
    if (pattern.test(normalized)) return value;
  }
  return null;
}

export function detectExactMetaAdLookup(text: string): {
  adId: string;
  dates: MetaDateSelection;
} | null {
  if (!METRIC_INTENT_RE.test(text)) return null;
  const ids = [...new Set(text.match(META_ID_RE) ?? [])];
  if (ids.length !== 1) return null;

  const isoDates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  let dates: MetaDateSelection;
  if (isoDates.length === 2) {
    dates = { since: isoDates[0], until: isoDates[1] };
  } else if (isoDates.length > 0) {
    // Never silently replace a partial or multi-window date request with the
    // default range. Let the normal agent ask for clarification instead.
    return null;
  } else {
    const preset = datePreset(text);
    dates = { datePreset: preset ?? "last_30d" };
  }
  return { adId: ids[0], dates };
}

export function isMetaDatePreset(value: string): value is MetaDatePreset {
  return (META_DATE_PRESETS as readonly string[]).includes(value);
}
