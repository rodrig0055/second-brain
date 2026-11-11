import type { ReactNode } from "react";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

export type Crumb = { label: string; href: string };

/**
 * The one page header: what the page is on the left, its actions on the right, and, on a detail
 * page, the trail back up above the title.
 *
 * - `breadcrumbs`: the ancestors of this page (`[{label: "Partners", href}]`). The title is added
 *   as the current crumb when it is plain text. Use them on detail pages; a top-level page has
 *   the sidebar to say where it is.
 * - `eyebrow`: real context the title lacks (the company above a lead's name), not a section label
 *   and not a link back (that is a breadcrumb).
 * - `action`: the page's buttons. The row wraps under the title on narrow screens instead of
 *   overflowing, because the app shell clips anything wider than the viewport.
 *
 * It renders no <header>: inside AppShell's `div role="main"` that element would be a second
 * page-level banner landmark.
 */
export function PageHeader({
  breadcrumbs,
  eyebrow,
  title,
  description,
  action,
}: {
  breadcrumbs?: Crumb[];
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <VStack gap={2} className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs variant="supporting">
          {breadcrumbs.map((crumb) => (
            <BreadcrumbItem key={crumb.href} href={crumb.href} isCurrent={false}>
              {crumb.label}
            </BreadcrumbItem>
          ))}
          {typeof title === "string" && <BreadcrumbItem isCurrent>{title}</BreadcrumbItem>}
        </Breadcrumbs>
      )}
      <HStack gap={3} wrap="wrap" vAlign="start" hAlign="between">
        <VStack gap={0.5} className="min-w-0 flex-1 basis-72">
          {eyebrow && (
            <Text type="supporting" color="secondary" maxLines={1}>
              {eyebrow}
            </Text>
          )}
          <Heading level={1}>{title}</Heading>
          {description && (
            <Text as="p" type="supporting" color="secondary" className="max-w-2xl">
              {description}
            </Text>
          )}
        </VStack>
        {action && (
          <HStack gap={2} wrap="wrap" vAlign="center" className="max-w-full">
            {action}
          </HStack>
        )}
      </HStack>
    </VStack>
  );
}
