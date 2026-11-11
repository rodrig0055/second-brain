/**
 * Re-encrypting every stored secret with the current write key.
 *
 * Lives here rather than in the script because the script cannot always run.
 * On Vercel a secret can be written but never read back, so the key being
 * rotated away from exists in exactly one usable place: the running
 * deployment. That means the rewrite has to be triggerable from inside the
 * app, and the admin action and the CLI both call this.
 *
 * Three tables hold secrets, and all three are covered, because a rotation
 * that misses one leaves a credential nobody can read and nobody expects.
 *
 * Safe to run twice: re-encrypting an already-current secret changes the blob,
 * because AES-GCM takes a fresh random iv each time, but not its meaning.
 */
import "server-only";

import { eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  brands,
  customLlmModels,
  integrationConnections,
  llmProviderKeys,
} from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type RotationOutcome = {
  table: string;
  label: string;
  /** rewritten | would rewrite | unreadable */
  status: "rewritten" | "would rewrite" | "unreadable";
};

export type RotationReport = {
  applied: boolean;
  rewritten: number;
  unreadable: number;
  outcomes: RotationOutcome[];
};

/**
 * Rewrite every stored secret with the current write key.
 *
 * A row that cannot be opened by any configured key is reported and left
 * exactly as it was. That is not a transient failure to retry: it was sealed
 * with a key nobody has any more, and the only way back is to reconnect that
 * integration.
 */
export async function rotateStoredSecrets(
  options: { apply?: boolean } = {},
): Promise<RotationReport> {
  const apply = options.apply === true;
  const outcomes: RotationOutcome[] = [];
  let rewritten = 0;
  let unreadable = 0;

  const handle = async (
    table: string,
    label: string,
    blob: string,
    write: (next: string) => Promise<unknown>,
  ) => {
    let plaintext: string;
    try {
      plaintext = decryptSecret(blob);
    } catch {
      unreadable++;
      outcomes.push({ table, label, status: "unreadable" });
      return;
    }
    if (apply) await write(encryptSecret(plaintext));
    rewritten++;
    outcomes.push({ table, label, status: apply ? "rewritten" : "would rewrite" });
  };

  const conns = await db
    .select({
      id: integrationConnections.id,
      platform: integrationConnections.platform,
      blob: integrationConnections.encryptedCredentials,
      brandName: brands.name,
    })
    .from(integrationConnections)
    .innerJoin(brands, eq(brands.id, integrationConnections.brandId))
    .where(isNotNull(integrationConnections.encryptedCredentials));

  for (const row of conns) {
    await handle(
      "integration_connections",
      `${row.brandName} / ${row.platform}`,
      row.blob as string,
      (next) =>
        db
          .update(integrationConnections)
          .set({ encryptedCredentials: next, updatedAt: new Date() })
          .where(eq(integrationConnections.id, row.id)),
    );
  }

  for (const row of await db.select().from(llmProviderKeys)) {
    await handle("llm_provider_keys", row.provider, row.encryptedKey, (next) =>
      db
        .update(llmProviderKeys)
        .set({ encryptedKey: next, updatedAt: new Date() })
        .where(eq(llmProviderKeys.provider, row.provider)),
    );
  }

  for (const row of await db.select().from(customLlmModels)) {
    await handle("custom_llm_models", row.label, row.encryptedKey, (next) =>
      db
        .update(customLlmModels)
        .set({ encryptedKey: next, updatedAt: new Date() })
        .where(eq(customLlmModels.id, row.id)),
    );
  }

  return { applied: apply, rewritten, unreadable, outcomes };
}
