import { PageLoading, SkeletonTable, SkeletonToolbar } from "@/components/skeleton";

/** Partners: the filters, then the partner table. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonToolbar pills={4} />
      <SkeletonTable rows={10} numbers={3} />
    </PageLoading>
  );
}
