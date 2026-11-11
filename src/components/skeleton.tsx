import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/VStack";

/**
 * Loading placeholders shaped like the page they stand in for, so the layout
 * does not jump when the data lands and the wait reads as progress.
 *
 * Every block is an Astryx Skeleton; `index` staggers the shimmer so a screen
 * of placeholders moves as one wave instead of blinking in unison. Wrap a
 * route's placeholders in `LoadingRegion` so a screen reader hears "Loading".
 */
export { Skeleton };

/** The live region every loading.tsx renders into. */
export function LoadingRegion({ children, label = "Loading" }: { children: ReactNode; label?: string }) {
  return (
    <VStack gap={4} role="status" aria-label={label} aria-busy>
      {children}
    </VStack>
  );
}

/** A filter row of pills. */
export function SkeletonToolbar({ pills = 3 }: { pills?: number }) {
  return (
    <HStack gap={2}>
      {Array.from({ length: pills }, (_, i) => (
        <Skeleton key={i} index={i} width={112} height={32} radius="rounded" />
      ))}
    </HStack>
  );
}

/** A page header: title and one line of description. */
export function SkeletonHeader() {
  return (
    <VStack gap={2}>
      <Skeleton width={176} height={24} />
      <Skeleton width="min(100%, 288px)" height={16} index={1} />
    </VStack>
  );
}

/** A row of KPI tiles: label, number, change. */
export function SkeletonKpis({ count = 4 }: { count?: number }) {
  return (
    <Grid columns={{ minWidth: 160, max: count }} gap={2}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} padding={3}>
          <VStack gap={2}>
            <Skeleton width={64} height={12} index={i} />
            <Skeleton width={96} height={20} index={i} />
            <Skeleton width={56} height={10} index={i} />
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

/** Content cards: a title and two lines each. */
export function SkeletonCards({ cards = 3 }: { cards?: number }) {
  return (
    <VStack gap={3}>
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i} padding={5}>
          <VStack gap={3}>
            <Skeleton width={160} height={16} index={i} />
            <VStack gap={2}>
              <Skeleton width="min(100%, 576px)" height={14} index={i} />
              <Skeleton width="min(66%, 448px)" height={14} index={i} />
            </VStack>
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}

/** Generic content: a filter row and a few cards. Used where a page has no shape of its own yet. */
export function SkeletonContent({ cards = 3 }: { cards?: number }) {
  return (
    <VStack gap={4}>
      <SkeletonToolbar pills={2} />
      <SkeletonCards cards={cards} />
    </VStack>
  );
}

/** Rows of a table: a short lead cell, a wide one, then numbers. */
export function SkeletonTable({ rows = 8, numbers = 2 }: { rows?: number; numbers?: number }) {
  return (
    <Card padding={0}>
      <VStack>
        {Array.from({ length: rows }, (_, i) => (
          <HStack
            key={i}
            gap={6}
            vAlign="center"
            paddingInline={4}
            paddingBlock={3}
            className="border-b border-border last:border-0"
          >
            <Skeleton width={96} height={14} index={i} />
            <Skeleton height={14} index={i} />
            {Array.from({ length: numbers }, (_, j) => (
              <Skeleton key={j} width={64} height={14} index={i} />
            ))}
          </HStack>
        ))}
      </VStack>
    </Card>
  );
}

/** A grid of square tiles: images, templates. */
export function SkeletonTiles({ count = 8, minWidth = 180 }: { count?: number; minWidth?: number }) {
  return (
    <Grid columns={{ minWidth }} gap={3}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} index={i} height="auto" radius={3} className="aspect-square" />
      ))}
    </Grid>
  );
}

/** A chart panel: a title and the plot area. */
export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Skeleton width={144} height={14} />
        <Skeleton height={height} index={1} />
      </VStack>
    </Card>
  );
}

const PAGE_WIDTH = {
  "3xl": "max-w-3xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
} as const;

/**
 * A whole page loading: the page frame, the header, then the content's shape.
 * For routes whose layout does not draw the header already.
 */
export function PageLoading({
  children,
  width = "7xl",
}: {
  children: ReactNode;
  width?: keyof typeof PAGE_WIDTH;
}) {
  return (
    <VStack gap={5} className={`mx-auto w-full ${PAGE_WIDTH[width]} px-4 py-5 sm:px-6 lg:px-8`}>
      <SkeletonHeader />
      <LoadingRegion>{children}</LoadingRegion>
    </VStack>
  );
}
