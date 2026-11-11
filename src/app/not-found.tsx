import { ErrorState } from "@/components/feedback/error-state";

/** Any URL that matches no route. Renders in the root layout, outside the app frame. */
export default function NotFound() {
  return (
    <ErrorState
      kind="not-found"
      title="Page not found"
      description="Check the address, or start again from Home."
    />
  );
}
