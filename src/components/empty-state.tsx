import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState as AstryxEmptyState } from "@astryxdesign/core/EmptyState";
import { Text } from "@astryxdesign/core/Text";

/**
 * An empty area that says what is missing and what to do next.
 *
 * Astryx EmptyState in a quiet card, so an empty section keeps the footprint of
 * the content it stands in for. `action` is the next step: a button, a link or
 * a short form. Leave it out only when the page already shows that step
 * directly above (a compose box, a filter to clear).
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  isCompact = false,
  headingLevel = 2,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** A lucide icon element; it is sized and tinted here. */
  icon?: ReactNode;
  isCompact?: boolean;
  /** h2 by default: most empty states sit straight under the page title. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <Card variant="muted" padding={isCompact ? 3 : 6}>
      <AstryxEmptyState
        title={title}
        description={description}
        isCompact={isCompact}
        headingLevel={headingLevel}
        icon={
          icon ? (
            <Text type="inherit" color="secondary" display="block" className="*:size-6">
              {icon}
            </Text>
          ) : undefined
        }
        actions={action}
      />
    </Card>
  );
}
