import { LoadingRegion, SkeletonTable, SkeletonToolbar } from "@/components/skeleton";

/** Performance is a table; the layout already drew the header. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonToolbar pills={4} />
      <SkeletonTable rows={10} numbers={4} />
    </LoadingRegion>
  );
}
