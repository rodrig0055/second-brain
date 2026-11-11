import type { integrationConnections } from "@/db/schema";

export type DbConnection = typeof integrationConnections.$inferSelect;

/** Inclusive date window for an ETL sync, YYYY-MM-DD. */
export type SyncWindow = { start: string; end: string };

export type SyncResult = { rowsWritten: number };

/** Minimal brand shape the tools/sync need (see src/db/schema.ts `brands`). */
export type ToolBrand = {
  id: string;
  slug: string;
  name: string;
  domain: string;
};
