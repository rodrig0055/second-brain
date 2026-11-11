import { ErrorState } from "@/components/feedback/error-state";

/**
 * `notFound()` from any signed-in page: a missing record, or a team or surface this account has no
 * access to (access checks answer 404 on purpose, so they do not confirm that it exists).
 */
export default function AppNotFound() {
  return (
    <ErrorState
      kind="not-found"
      title="Nothing here"
      description="This page doesn't exist, was deleted, or belongs to a team you don't have access to."
    />
  );
}
