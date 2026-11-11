import { LoadingRegion, SkeletonTable, SkeletonToolbar } from "@/components/skeleton";

/** Posts: the filter row, then table rows. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonToolbar pills={4} />
      <SkeletonTable rows={8} numbers={3} />
    </LoadingRegion>
  );
}
