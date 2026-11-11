import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { merchantOverrideSources, merchantTitleBatches, merchantTitleChanges } from "@/db/schema";
import {
  MAX_BATCH_SIZE,
  MAX_TITLE_LENGTH,
  OVERRIDE_SOURCE_NAME,
  brandMerchantAccount,
  ruleWithOverrideFirst,
  ruleWithoutOverride,
} from "./accounts";
import {
  type DataSource,
  type Product,
  createSupplementalApiSource,
  deleteDataSource,
  deleteInput,
  getDataSource,
  insertTitleInput,
  listDataSources,
  listProducts,
  productKey,
  setPrimaryDefaultRule,
} from "./client";

/**
 * Title overrides, end to end. The chat only ever calls proposeTitleBatch,
 * which writes to Postgres. applyTitleBatch and revertTitleBatch are reached
 * from the batch card's buttons (server actions that check the clicking user is
 * an admin), never from a tool, so the model cannot push to Google on its own.
 */

const CATALOG_SCAN_LIMIT = 20_000;

export type ProposedChange = { offerId: string; newTitle: string; contentLanguage?: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The whole catalog (one scan). The same offer id can appear once per language
 * (TH has a Thai and an English feed), so the key is `language~offerId`.
 */
export async function catalogScan(accountId: string): Promise<Product[]> {
  return listProducts(accountId, CATALOG_SCAN_LIMIT);
}

const langKey = (contentLanguage: string, offerId: string) => `${contentLanguage}~${offerId}`;

function byLangOffer(products: Product[]): Map<string, Product> {
  return new Map(products.map((p) => [langKey(p.contentLanguage, p.offerId), p]));
}

export async function proposeTitleBatch(input: {
  brandId: string;
  brandSlug: string;
  accountId: string;
  changes: ProposedChange[];
  note?: string;
  userId?: string;
}): Promise<{ batchId: string; count: number; skipped: { offerId: string; reason: string }[] }> {
  const account = brandMerchantAccount(input.brandSlug, input.accountId);
  if (!account) throw new Error(`Account ${input.accountId} is not one of this brand's Merchant Center accounts.`);
  if (input.changes.length === 0) throw new Error("No changes to propose.");
  if (input.changes.length > MAX_BATCH_SIZE) {
    throw new Error(`At most ${MAX_BATCH_SIZE} titles per batch; split it.`);
  }

  const products = await catalogScan(account.id);
  const skipped: { offerId: string; reason: string }[] = [];
  const seen = new Set<string>();
  const rows: (typeof merchantTitleChanges.$inferInsert)[] = [];

  for (const c of input.changes) {
    const title = c.newTitle.replace(/\s+/g, " ").trim();
    const matches = products.filter(
      (p) => p.offerId === c.offerId && (!c.contentLanguage || p.contentLanguage === c.contentLanguage),
    );
    const product = matches.length === 1 ? matches[0] : undefined;
    const key = product ? langKey(product.contentLanguage, product.offerId) : c.offerId;
    if (matches.length > 1) {
      skipped.push({
        offerId: c.offerId,
        reason: `listed in ${matches.map((m) => m.contentLanguage).join(" and ")}: say which contentLanguage`,
      });
    } else if (seen.has(key)) skipped.push({ offerId: c.offerId, reason: "duplicate in batch" });
    else if (!product) skipped.push({ offerId: c.offerId, reason: "not in this account's catalog" });
    else if (!title) skipped.push({ offerId: c.offerId, reason: "empty title" });
    else if (title.length > MAX_TITLE_LENGTH) {
      skipped.push({ offerId: c.offerId, reason: `title is ${title.length} chars (max ${MAX_TITLE_LENGTH})` });
    } else if (title === product.productAttributes?.title) {
      skipped.push({ offerId: c.offerId, reason: "same as the current title" });
    } else {
      seen.add(key);
      rows.push({
        batchId: "", // set below
        offerId: c.offerId,
        contentLanguage: product.contentLanguage,
        feedLabel: product.feedLabel,
        oldTitle: product.productAttributes?.title ?? "",
        newTitle: title,
      });
    }
  }
  if (rows.length === 0) throw new Error(`Nothing to propose: ${skipped.map((s) => `${s.offerId} (${s.reason})`).join(", ")}`);

  const [batch] = await db
    .insert(merchantTitleBatches)
    .values({ brandId: input.brandId, accountId: account.id, note: input.note, createdBy: input.userId })
    .returning({ id: merchantTitleBatches.id });
  await db.insert(merchantTitleChanges).values(rows.map((r) => ({ ...r, batchId: batch.id })));
  return { batchId: batch.id, count: rows.length, skipped };
}

// ---- Override source + feed rule ----

/** Find or create our supplemental API source in the account. */
async function ensureOverrideSource(accountId: string): Promise<string> {
  const existing = (await listDataSources(accountId)).find(
    (d) => d.displayName === OVERRIDE_SOURCE_NAME && d.supplementalProductDataSource && d.input === "API",
  );
  if (existing) return existing.name;
  const created = await createSupplementalApiSource(accountId, OVERRIDE_SOURCE_NAME);
  return created.name;
}

/**
 * Put our source first in a primary source's rule. The rule as it was is saved
 * once (the first time), the new rule is checked by ruleWithOverrideFirst, and
 * Google's answer is checked again before we write any title.
 */
async function linkOverride(accountId: string, primaryName: string, overrideName: string): Promise<void> {
  const primary: DataSource = await getDataSource(primaryName);
  if (!primary.primaryProductDataSource) throw new Error(`${primaryName} is not a primary product source.`);
  const current = primary.primaryProductDataSource.defaultRule?.takeFromDataSources;

  await db
    .insert(merchantOverrideSources)
    .values({ accountId, primaryDataSourceName: primaryName, dataSourceName: overrideName, previousRule: current ?? [] })
    .onConflictDoNothing();

  const next = ruleWithOverrideFirst(current, overrideName);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  const saved = await setPrimaryDefaultRule(primaryName, next);
  const rule = saved.primaryProductDataSource?.defaultRule?.takeFromDataSources ?? [];
  if (rule[0]?.supplementalDataSourceName !== overrideName || !rule.some((t) => t.self)) {
    throw new Error(`Google saved an unexpected rule on ${primaryName}: ${JSON.stringify(rule)}`);
  }
}

/** Take our source out of every rule it was put in, then delete it. */
async function unlinkOverride(accountId: string): Promise<void> {
  const links = await db
    .select()
    .from(merchantOverrideSources)
    .where(eq(merchantOverrideSources.accountId, accountId));
  for (const link of links) {
    const primary = await getDataSource(link.primaryDataSourceName);
    const current = primary.primaryProductDataSource?.defaultRule?.takeFromDataSources;
    if (current?.some((t) => t.supplementalDataSourceName === link.dataSourceName)) {
      await setPrimaryDefaultRule(link.primaryDataSourceName, ruleWithoutOverride(current, link.dataSourceName));
    }
  }
  const names = new Set(links.map((l) => l.dataSourceName));
  for (const name of names) await deleteDataSource(name);
  await db.delete(merchantOverrideSources).where(eq(merchantOverrideSources.accountId, accountId));
}

// ---- Apply / revert ----

export async function applyTitleBatch(batchId: string, userId: string): Promise<void> {
  // Claim the batch: a double click, or two admins, cannot apply it twice.
  const [batch] = await db
    .update(merchantTitleBatches)
    .set({ status: "applying", approvedBy: userId, approvedAt: new Date() })
    .where(and(eq(merchantTitleBatches.id, batchId), eq(merchantTitleBatches.status, "pending")))
    .returning();
  if (!batch) throw new Error("This batch is not pending any more.");

  const changes = await db.select().from(merchantTitleChanges).where(eq(merchantTitleChanges.batchId, batchId));
  try {
    const overrideName = await ensureOverrideSource(batch.accountId);
    const catalog = byLangOffer(await catalogScan(batch.accountId));
    const primaries = new Set<string>();
    for (const c of changes) {
      const p = catalog.get(langKey(c.contentLanguage, c.offerId));
      if (p) primaries.add(p.dataSource);
    }
    for (const primary of primaries) await linkOverride(batch.accountId, primary, overrideName);

    let ok = 0;
    for (const c of changes) {
      try {
        if (!catalog.has(langKey(c.contentLanguage, c.offerId))) throw new Error("product is no longer in the catalog");
        await insertTitleInput(batch.accountId, overrideName, {
          offerId: c.offerId,
          contentLanguage: c.contentLanguage,
          feedLabel: c.feedLabel,
          title: c.newTitle,
        });
        await db.update(merchantTitleChanges).set({ status: "applied", errorMessage: null }).where(eq(merchantTitleChanges.id, c.id));
        ok++;
      } catch (e) {
        await db
          .update(merchantTitleChanges)
          .set({ status: "failed", errorMessage: errMsg(e) })
          .where(eq(merchantTitleChanges.id, c.id));
      }
    }
    await db
      .update(merchantTitleBatches)
      .set({ status: ok === changes.length ? "applied" : ok === 0 ? "failed" : "partial" })
      .where(eq(merchantTitleBatches.id, batchId));
  } catch (e) {
    await db
      .update(merchantTitleBatches)
      .set({ status: "failed", errorMessage: errMsg(e) })
      .where(eq(merchantTitleBatches.id, batchId));
    throw e;
  }
}

/**
 * Remove this batch's titles. Google keeps one override per product, so when
 * another live batch also changed a product, its title is put back rather than
 * leaving the feed title. When nothing is overridden in the account any more,
 * the source is unlinked from the feed rule and deleted.
 */
export async function revertTitleBatch(batchId: string, userId: string): Promise<void> {
  const batch = await db.query.merchantTitleBatches.findFirst({ where: eq(merchantTitleBatches.id, batchId) });
  if (!batch || !["applied", "partial"].includes(batch.status)) throw new Error("Only an applied batch can be reverted.");
  const link = await db.query.merchantOverrideSources.findFirst({
    where: eq(merchantOverrideSources.accountId, batch.accountId),
  });
  if (!link) throw new Error("No override source recorded for this account.");

  const changes = await db
    .select()
    .from(merchantTitleChanges)
    .where(and(eq(merchantTitleChanges.batchId, batchId), eq(merchantTitleChanges.status, "applied")));

  for (const c of changes) {
    const others = await db
      .select({ newTitle: merchantTitleChanges.newTitle })
      .from(merchantTitleChanges)
      .innerJoin(merchantTitleBatches, eq(merchantTitleChanges.batchId, merchantTitleBatches.id))
      .where(
        and(
          eq(merchantTitleBatches.accountId, batch.accountId),
          ne(merchantTitleChanges.batchId, batchId),
          eq(merchantTitleChanges.offerId, c.offerId),
          eq(merchantTitleChanges.contentLanguage, c.contentLanguage),
          eq(merchantTitleChanges.status, "applied"),
        ),
      )
      .orderBy(desc(merchantTitleBatches.approvedAt))
      .limit(1);
    const key = productKey(c.contentLanguage, c.feedLabel, c.offerId);
    if (others[0]) {
      await insertTitleInput(batch.accountId, link.dataSourceName, {
        offerId: c.offerId,
        contentLanguage: c.contentLanguage,
        feedLabel: c.feedLabel,
        title: others[0].newTitle,
      });
    } else {
      await deleteInput(batch.accountId, link.dataSourceName, key);
    }
    await db.update(merchantTitleChanges).set({ status: "reverted" }).where(eq(merchantTitleChanges.id, c.id));
  }

  await db
    .update(merchantTitleBatches)
    .set({ status: "reverted", revertedBy: userId, revertedAt: new Date() })
    .where(eq(merchantTitleBatches.id, batchId));

  const stillLive = await db
    .select({ id: merchantTitleBatches.id })
    .from(merchantTitleBatches)
    .where(
      and(
        eq(merchantTitleBatches.accountId, batch.accountId),
        inArray(merchantTitleBatches.status, ["applied", "partial", "applying"]),
      ),
    )
    .limit(1);
  if (stillLive.length === 0) await unlinkOverride(batch.accountId);
}

export type TitleBatchView = {
  id: string;
  accountId: string;
  accountLabel: string;
  live: boolean;
  status: string;
  note: string | null;
  errorMessage: string | null;
  approvedAt: string | null;
  revertedAt: string | null;
  changes: { offerId: string; oldTitle: string; newTitle: string; status: string; errorMessage: string | null }[];
};

export async function getTitleBatchView(batchId: string, brandSlug: string): Promise<TitleBatchView | null> {
  const batch = await db.query.merchantTitleBatches.findFirst({ where: eq(merchantTitleBatches.id, batchId) });
  if (!batch) return null;
  const account = brandMerchantAccount(brandSlug, batch.accountId);
  if (!account) return null;
  const changes = await db
    .select()
    .from(merchantTitleChanges)
    .where(eq(merchantTitleChanges.batchId, batchId))
    .orderBy(merchantTitleChanges.offerId);
  return {
    id: batch.id,
    accountId: batch.accountId,
    accountLabel: account.label,
    live: account.live,
    status: batch.status,
    note: batch.note,
    errorMessage: batch.errorMessage,
    approvedAt: batch.approvedAt?.toISOString() ?? null,
    revertedAt: batch.revertedAt?.toISOString() ?? null,
    changes: changes.map((c) => ({
      offerId: c.offerId,
      oldTitle: c.oldTitle,
      newTitle: c.newTitle,
      status: c.status,
      errorMessage: c.errorMessage,
    })),
  };
}
