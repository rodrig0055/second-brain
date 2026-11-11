import { LoadingRegion, SkeletonTiles } from "@/components/skeleton";

/** Connections: a row of platform cards per brand. */
export default function Loading() {
  return (
    <LoadingRegion>
      <SkeletonTiles count={5} minWidth={200} />
      <SkeletonTiles count={5} minWidth={200} />
    </LoadingRegion>
  );
}
