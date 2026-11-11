import { PageLoading, SkeletonTable, SkeletonToolbar } from "@/components/skeleton";

/** Newsletter: the actions and brand chips, then the campaign list. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonToolbar pills={3} />
      <SkeletonTable rows={8} numbers={2} />
    </PageLoading>
  );
}
