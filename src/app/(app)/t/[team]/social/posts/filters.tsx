"use client";

import { Layers } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icon";
import { QueryFilter } from "@/components/ui/filter-pill";

/**
 * Channel and type, as pills that apply on pick. Caption search lives on the
 * table itself, next to the rows it narrows.
 */
export function PostFilterPills() {
  return (
    <>
      <QueryFilter
        name="channel"
        allLabel="All channels"
        options={[
          { value: "instagram", label: "Instagram", icon: <PlatformIcon name="instagram" size="xs" /> },
          { value: "facebook", label: "Facebook", icon: <PlatformIcon name="facebook" size="xs" /> },
        ]}
      />
      <QueryFilter
        name="mediaType"
        allLabel="All types"
        icon={<Layers className="size-3.5 text-zinc-400" />}
        options={[
          { value: "IMAGE", label: "Image" },
          { value: "VIDEO", label: "Video" },
          { value: "CAROUSEL_ALBUM", label: "Carousel" },
          { value: "REELS", label: "Reel" },
        ]}
      />
    </>
  );
}
