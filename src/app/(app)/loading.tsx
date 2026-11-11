import { PageLoading, SkeletonContent } from "@/components/skeleton";

/**
 * Any page without a loading state of its own: a header and some cards, so a
 * slow page reads as on its way instead of as a click that did nothing.
 */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonContent />
    </PageLoading>
  );
}
