import { PageLoading, SkeletonChart, SkeletonKpis, SkeletonToolbar } from "@/components/skeleton";

/** Dashboards: the switcher, headline numbers, then a chart. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonToolbar pills={3} />
      <SkeletonKpis count={6} />
      <SkeletonChart />
    </PageLoading>
  );
}
