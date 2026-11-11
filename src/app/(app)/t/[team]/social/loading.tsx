import { LoadingRegion, SkeletonKpis, SkeletonToolbar } from "@/components/skeleton";

/** Overview: the filter row, then a row of numbers per brand. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonToolbar pills={2} />
      <SkeletonKpis count={4} />
      <SkeletonKpis count={4} />
    </LoadingRegion>
  );
}
