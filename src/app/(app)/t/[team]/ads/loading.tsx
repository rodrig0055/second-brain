import { LoadingRegion, SkeletonContent } from "@/components/skeleton";

/** Ads pages: the filter row and cards; the layout already drew the header. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonContent />
    </LoadingRegion>
  );
}
