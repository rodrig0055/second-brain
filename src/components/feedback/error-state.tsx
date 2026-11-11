"use client";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

/**
 * The one full-area message for "this page cannot show": a crash caught by an error boundary, or a
 * URL that does not exist (or that this account is not allowed to see, which `notFound()` hides
 * on purpose). Centred in the space the page would have used, so the app frame stays usable.
 */
export function ErrorState({
  kind,
  title,
  description,
  digest,
  onRetry,
}: {
  kind: "error" | "not-found";
  title: string;
  description: string;
  /** Next's server error id: matches the server log line, so it is worth showing to whoever reports it. */
  digest?: string;
  onRetry?: () => void;
}) {
  return (
    <VStack hAlign="center" vAlign="center" minHeight="60vh" padding={6} gap={3}>
      <EmptyState
        headingLevel={1}
        icon={<Icon icon={kind === "error" ? "warning" : "search"} size="lg" color="secondary" />}
        title={title}
        description={description}
        actions={
          <>
            <Button label="Go to Home" variant={onRetry ? "secondary" : "primary"} href="/" />
            {onRetry && <Button label="Try again" variant="primary" onClick={onRetry} />}
          </>
        }
      />
      {digest && (
        <Text type="supporting" color="secondary">
          Error reference: {digest}
        </Text>
      )}
    </VStack>
  );
}
