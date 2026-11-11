import { PageLoading, SkeletonCards, SkeletonTiles } from "@/components/skeleton";

/** Images: the generator, then the gallery. */
export default function Loading() {
  return (
    <PageLoading width="6xl">
      <SkeletonCards cards={1} />
      <SkeletonTiles count={8} />
    </PageLoading>
  );
}
