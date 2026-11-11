import type { EntityLevel } from "./entities";

/**
 * The levels the mirror syncs.
 *
 * Its own module so the decision can be asserted in a test without importing
 * `entity-sync.ts`, which is server-only and opens a database connection.
 */
export function syncedLevels(): EntityLevel[] {
  return ["campaign", "adset"];
}
