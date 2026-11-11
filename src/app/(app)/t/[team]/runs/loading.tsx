import { PageLoading, SkeletonCards } from "@/components/skeleton";

/** Outputs: a list of saved runs. */
export default function Loading() {
  return (
    <PageLoading width="3xl">
      <SkeletonCards cards={5} />
    </PageLoading>
  );
}
