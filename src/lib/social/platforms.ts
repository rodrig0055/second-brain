import {
  siFacebook,
  siGoogle,
  siInstagram,
  siPinterest,
  siThreads,
  siTiktok,
  siX,
  siYoutube,
} from "simple-icons";

/**
 * Every social platform the workspace knows about, live or not.
 *
 * `live` means this app can publish to it and read it back today. The rest are
 * listed so the Connections page shows the whole map instead of pretending the
 * world is two platforms, and so adding one is a status change here plus an
 * adapter, not a new screen.
 */

export type PlatformKey =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "threads"
  | "pinterest"
  | "x"
  | "google_business";

export type Platform = {
  key: PlatformKey;
  label: string;
  /** Tile background. Brand colours, so the icon reads at a glance. */
  color: string;
  /** SVG path on a 24x24 box, or null for a lettermark. */
  path: string | null;
  letter?: string;
  status: "live" | "planned";
  /** One line on what connecting it gives you. */
  blurb: string;
};

export const PLATFORMS: Platform[] = [
  {
    key: "instagram",
    label: "Instagram",
    color: `#${siInstagram.hex}`,
    path: siInstagram.path,
    status: "live",
    blurb: "Posts, Reels and carousels, with reach and engagement.",
  },
  {
    key: "facebook",
    label: "Facebook Page",
    color: `#${siFacebook.hex}`,
    path: siFacebook.path,
    status: "live",
    blurb: "Page posts, scheduled by Meta, with engagement.",
  },
  {
    key: "tiktok",
    label: "TikTok",
    color: `#${siTiktok.hex}`,
    path: siTiktok.path,
    status: "planned",
    blurb: "Videos and photo posts.",
  },
  {
    key: "youtube",
    label: "YouTube",
    color: `#${siYoutube.hex}`,
    path: siYoutube.path,
    status: "planned",
    blurb: "Shorts and videos.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    color: "#0A66C2",
    path: null,
    letter: "in",
    status: "planned",
    blurb: "Company page posts, for the corporate brands.",
  },
  {
    key: "threads",
    label: "Threads",
    color: `#${siThreads.hex}`,
    path: siThreads.path,
    status: "planned",
    blurb: "Text and image posts, linked to Instagram.",
  },
  {
    key: "pinterest",
    label: "Pinterest",
    color: `#${siPinterest.hex}`,
    path: siPinterest.path,
    status: "planned",
    blurb: "Pins to a board.",
  },
  {
    key: "x",
    label: "X",
    color: `#${siX.hex}`,
    path: siX.path,
    status: "planned",
    blurb: "Posts and threads.",
  },
  {
    key: "google_business",
    label: "Google Business",
    color: `#${siGoogle.hex}`,
    path: siGoogle.path,
    status: "planned",
    blurb: "Updates and offers on the shop's Google profile.",
  },
];

const BY_KEY = new Map(PLATFORMS.map((p) => [p.key, p]));

export function platform(key: PlatformKey): Platform {
  return BY_KEY.get(key)!;
}
