import { PageLoading, SkeletonChart, SkeletonKpis, SkeletonToolbar } from "@/components/skeleton";

/** Insights: brand picker, the five headline numbers, then the revenue chart. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonToolbar pills={4} />
      <SkeletonKpis count={5} />
      <SkeletonChart />
    </PageLoading>
  );
}
