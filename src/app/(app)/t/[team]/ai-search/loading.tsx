import { PageLoading, SkeletonKpis, SkeletonTable } from "@/components/skeleton";

/** AI search: the share-of-answer numbers, then the answers. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonKpis count={4} />
      <SkeletonTable rows={8} numbers={3} />
    </PageLoading>
  );
}
