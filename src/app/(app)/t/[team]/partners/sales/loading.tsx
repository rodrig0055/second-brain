import { PageLoading, SkeletonKpis, SkeletonTable } from "@/components/skeleton";

/** Partner sales: the four totals, then the per-partner table. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonKpis count={4} />
      <SkeletonTable rows={8} numbers={4} />
    </PageLoading>
  );
}
