import { PageLoading, SkeletonCards } from "@/components/skeleton";

/** One partner: details, contacts and the contact log, as cards. */
export default function Loading() {
  return (
    <PageLoading>
      <SkeletonCards cards={3} />
    </PageLoading>
  );
}
