import { LoadingRegion, SkeletonTable } from "@/components/skeleton";

/** Settings pages are mostly lists; the layout already drew the header. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTable rows={6} />
    </LoadingRegion>
  );
}
