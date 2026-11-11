"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  brands,
  customLlmModels,
  integrationConnections,
  llmProviderKeys,
} from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import {
  decryptSecret,
  decryptionKeyCount,
  encryptSecret,
  encryptionConfigured,
  rotationInFlight,
} from "@/lib/crypto";
import { rotateStoredSecrets } from "@/lib/crypto-rotation";
import { verifyShopifyCredentials } from "@/lib/integrations/shopify/client";
import { normalizeAccountId, verifyMetaCredentials, verifyMetaWriteAccess } from "@/lib/integrations/meta/client";
import { verifyOrganicCredentials } from "@/lib/integrations/meta_organic/client";
import {
  normalizeCustomerId,
  verifyGoogleAdsCredentials,
} from "@/lib/integrations/google_ads/client";
import {
  normalizePropertyId,
  verifyGa4Credentials,
} from "@/lib/integrations/ga4/client";
import { verifySendpulse } from "@/lib/integrations/sendpulse/client";
import {
  CMS_TENANTS,
  type CmsCredentials,
  normalizeCmsHost,
  verifyCmsCredentials,
} from "@/lib/integrations/cms/client";
import { syncConnection } from "@/lib/integrations/sync";
import {
  PENDING_COOKIE,
  createAdsConnections,
  openPending,
} from "@/lib/integrations/tiktok_ads/connect";
import { invalidateProviderKeyCache } from "@/lib/llm-keys";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * Result returned to `useActionState`-driven admin forms. Actions return an
 * error string instead of throwing so validation and live credential-check
 * failures render inline on the form rather than crashing to the error overlay.
 * Note: `requireAdmin()` is always called BEFORE the try/catch so its
 * redirect()/notFound() navigation signals keep propagating.
 */
export type FormState = { error?: string; ok?: boolean };

/** What the encryption-key rotation button reports back. */
export type RotationState = {
  error?: string;
  ok?: boolean;
  applied?: boolean;
  rewritten?: number;
  unreadable?: number;
  writeKey?: string;
  keyCount?: number;
  lines?: string[];
};

const OK: FormState = { ok: true };

/** First Zod issue as "field: message" for a readable inline error. */
function firstIssue(error: z.ZodError): string {
  const i = error.issues[0];
  const field = i?.path.join(".");
  return field ? `${field}: ${i?.message}` : (i?.message ?? "Invalid input");
}

function toErr(err: unknown): FormState {
  return { error: err instanceof Error ? err.message : String(err) };
}

const llmKeySchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  apiKey: z.string().trim().min(10),
});

export async function saveLlmKey(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before saving keys.",
    };
  }

  const parsed = llmKeySchema.safeParse({
    provider: String(formData.get("provider") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid API key: ${firstIssue(parsed.error)}` };
  }

  try {
    const encrypted = encryptSecret(parsed.data.apiKey);
    const hint = parsed.data.apiKey.slice(-4);

    await db
      .insert(llmProviderKeys)
      .values({
        provider: parsed.data.provider,
        encryptedKey: encrypted,
        hint,
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: llmProviderKeys.provider,
        set: { encryptedKey: encrypted, hint, updatedAt: new Date() },
      });

    invalidateProviderKeyCache();
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

export async function deleteLlmKey(formData: FormData) {
  await requireAdmin();
  const provider = String(formData.get("provider") ?? "");
  if (!provider) return;
  await db
    .delete(llmProviderKeys)
    .where(
      eq(
        llmProviderKeys.provider,
        provider as "anthropic" | "openai" | "google",
      ),
    );
  invalidateProviderKeyCache();
  revalidatePath("/admin/integrations");
}

const customModelSchema = z.object({
  label: z.string().trim().min(2).max(80),
  baseUrl: z.string().trim().url(),
  modelName: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(10),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function saveCustomModel(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before saving keys.",
    };
  }

  const parsed = customModelSchema.safeParse({
    label: String(formData.get("label") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    modelName: String(formData.get("modelName") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid custom model: ${firstIssue(parsed.error)}` };
  }

  try {
    // Reserved slugs would collide with the built-in providers in resolveModel.
    const base = slugify(parsed.data.label) || "model";
    let slug = ["anthropic", "openai", "google"].includes(base)
      ? `${base}-custom`
      : base;
    const existing = new Set(
      (await db.query.customLlmModels.findMany({ columns: { slug: true } })).map(
        (r) => r.slug,
      ),
    );
    if (existing.has(slug)) {
      let n = 2;
      while (existing.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }

    await db.insert(customLlmModels).values({
      slug,
      label: parsed.data.label,
      baseUrl: parsed.data.baseUrl,
      modelName: parsed.data.modelName,
      encryptedKey: encryptSecret(parsed.data.apiKey),
      hint: parsed.data.apiKey.slice(-4),
      createdById: admin.id,
    });

    invalidateProviderKeyCache();
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

export async function deleteCustomModel(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(customLlmModels).where(eq(customLlmModels.id, id));
  invalidateProviderKeyCache();
  revalidatePath("/admin/integrations");
}

const shopifySchema = z.object({
  brandId: z.string().uuid(),
  shop: z.string().min(3),
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
});

function normalizeShop(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export async function connectShopify(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before connecting.",
    };
  }

  const parsed = shopifySchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    shop: String(formData.get("shop") ?? ""),
    clientId: String(formData.get("clientId") ?? ""),
    clientSecret: String(formData.get("clientSecret") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid Shopify connection: ${firstIssue(parsed.error)}` };
  }

  const shop = normalizeShop(parsed.data.shop);

  try {
    // Fail fast: mint a token now to confirm the credentials + shop are valid.
    const info = await verifyShopifyCredentials(
      shop,
      parsed.data.clientId,
      parsed.data.clientSecret,
    );

    const encrypted = encryptSecret(
      JSON.stringify({
        clientId: parsed.data.clientId,
        clientSecret: parsed.data.clientSecret,
      }),
    );

    const config = await mergedConfig(parsed.data.brandId, "shopify", shop, { shop });

    const [conn] = await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "shopify",
        displayName: info.name || shop,
        externalAccountId: shop,
        authType: "client_credentials",
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          encryptedCredentials: encrypted,
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Kick off an initial backfill so the dashboard/tools have data immediately.
    try {
      await syncConnection(conn);
    } catch (err) {
      console.error("initial shopify sync failed", err);
    }
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const metaSchema = z.object({
  brandId: z.string().uuid(),
  accessToken: z.string().trim().min(20),
  adAccountId: z.string().trim().min(1),
  // Needed only to create ads from here: an ad has to name the Page it runs as.
  pageId: z
    .string()
    .trim()
    .regex(/^\d*$/, "Page id is all digits")
    .optional(),
  instagramUserId: z
    .string()
    .trim()
    .regex(/^\d*$/, "Instagram account id is all digits")
    .optional(),
  /** Off unless someone deliberately turns it on for this account. */
  writeEnabled: z.boolean().optional(),
});

/**
 * Merge new config into whatever the connection already had.
 *
 * Reconnecting used to replace the whole `config` blob, which quietly dropped
 * every key the connect form does not ask for — including `writeEnabled`,
 * `pageId` and `instagramUserId`, the three the Meta write path needs. Pasting
 * a fresh token then turned writes off with no message anywhere.
 */
async function mergedConfig(
  brandId: string,
  platform: DbConnection["platform"],
  externalAccountId: string,
  next: Record<string, string | number | boolean>,
): Promise<Record<string, string | number | boolean>> {
  const existing = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, platform),
      eq(integrationConnections.externalAccountId, externalAccountId),
    ),
  });
  return { ...(existing?.config ?? {}), ...next };
}


export async function connectMeta(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before connecting.",
    };
  }
  const parsed = metaSchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    accessToken: String(formData.get("accessToken") ?? ""),
    adAccountId: String(formData.get("adAccountId") ?? ""),
    pageId: String(formData.get("pageId") ?? "") || undefined,
    instagramUserId: String(formData.get("instagramUserId") ?? "") || undefined,
    writeEnabled: formData.get("writeEnabled") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    return { error: `Invalid Meta connection: ${firstIssue(parsed.error)}` };
  }

  const adAccountId = normalizeAccountId(parsed.data.adAccountId);

  try {
    // Fail fast: confirm the token + account work before storing anything.
    const info = await verifyMetaCredentials(parsed.data.accessToken, adAccountId);

    const encrypted = encryptSecret(
      JSON.stringify({ accessToken: parsed.data.accessToken }),
    );

    // Whatever else is on this connection survives a reconnect: the write
    // settings below are set separately and must not vanish when a token is
    // rotated.
    const config = await mergedConfig(parsed.data.brandId, "meta", adAccountId, {
      adAccountId,
      currency: info.currency,
      timezone: info.timezone,
      ...(parsed.data.pageId ? { pageId: parsed.data.pageId } : {}),
      ...(parsed.data.instagramUserId
        ? { instagramUserId: parsed.data.instagramUserId }
        : {}),
      ...(parsed.data.writeEnabled !== undefined
        ? { writeEnabled: parsed.data.writeEnabled }
        : {}),
    });

    const [conn] = await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "meta",
        displayName: info.name,
        externalAccountId: adAccountId,
        authType: "system_user_token",
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          encryptedCredentials: encrypted,
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    try {
      await syncConnection(conn);
    } catch (err) {
      console.error("initial meta sync failed", err);
    }
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const metaOrganicSchema = z.object({
  brandId: z.string().uuid(),
  accessToken: z.string().trim().min(20),
  pageId: z.string().trim().regex(/^\d+$/, "Page id must be numeric"),
});

/**
 * Connect a Facebook Page + its linked Instagram account for ORGANIC posting.
 *
 * Separate from `connectMeta` even when the same system user token serves both,
 * because the two are different assets with different failure modes: an ad
 * account grant says nothing about whether the token can post as the Page, and
 * a Page with no Instagram linked gives no warning until a publish has nowhere
 * to go. The Instagram id is discovered from the Page rather than typed, since
 * a mistyped one would connect cleanly and post to someone else's account.
 */
export async function connectMetaOrganic(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before connecting.",
    };
  }
  const parsed = metaOrganicSchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    accessToken: String(formData.get("accessToken") ?? ""),
    pageId: String(formData.get("pageId") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid Meta organic connection: ${firstIssue(parsed.error)}` };
  }

  try {
    // Proves the token reaches this Page AND can mint a Page token, which is
    // what publishing actually needs. Storing first and finding out later would
    // mean the first failure is a post that did not go out.
    const info = await verifyOrganicCredentials(
      parsed.data.accessToken,
      parsed.data.pageId,
    );

    const encrypted = encryptSecret(
      JSON.stringify({ accessToken: parsed.data.accessToken }),
    );
    const config = {
      pageId: info.pageId,
      pageName: info.pageName,
      igUserId: info.igUserId,
      igUsername: info.igUsername,
      // 0 means a non-expiring system user token. A real timestamp here is
      // worth surfacing in the UI: it works now and stops mid-week later.
      tokenExpiresAt: info.expiresAt,
    };

    const [conn] = await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "meta_organic",
        displayName: info.igUsername
          ? `${info.pageName} + @${info.igUsername}`
          : info.pageName,
        externalAccountId: info.pageId,
        authType: "system_user_token",
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          encryptedCredentials: encrypted,
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    try {
      await syncConnection(conn);
    } catch (err) {
      console.error("initial meta organic sync failed", err);
    }
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const googleAdsSchema = z.object({
  brandId: z.string().uuid(),
  developerToken: z.string().trim().min(10),
  clientId: z.string().trim().min(10),
  clientSecret: z.string().trim().min(10),
  refreshToken: z.string().trim().min(20),
  customerId: z.string().trim().min(8),
  loginCustomerId: z.string().trim().optional(),
});

/**
 * Turn Meta writes on or off for one ad account.
 *
 * Separate from connecting, because the two are different decisions made at
 * different times: a read-only connection is useful on its own, and enabling
 * changes needs a token with ads_management and the account assigned with a
 * task that permits them. Verified before it is stored, so the form can name
 * exactly what is missing rather than letting a pause button fail silently
 * later.
 */
export async function updateMetaWriteSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();

  const connectionId = String(formData.get("connectionId") ?? "");
  const writeEnabled = formData.get("writeEnabled") === "on";
  const pageId = String(formData.get("pageId") ?? "").trim();
  const instagramUserId = String(formData.get("instagramUserId") ?? "").trim();

  const conn = await db.query.integrationConnections.findFirst({
    where: eq(integrationConnections.id, connectionId),
  });
  if (!conn || conn.platform !== "meta") {
    return { error: "That is not a Meta ad account." };
  }
  if (pageId && !/^\d+$/.test(pageId)) return { error: "A Page id is all digits." };
  if (instagramUserId && !/^\d+$/.test(instagramUserId)) {
    return { error: "An Instagram account id is all digits." };
  }

  let discoveredIg = instagramUserId;

  if (writeEnabled) {
    if (!conn.encryptedCredentials) {
      return { error: "This connection has no stored token. Reconnect it first." };
    }
    const { accessToken } = JSON.parse(decryptSecret(conn.encryptedCredentials)) as {
      accessToken: string;
    };
    const accountId = String(conn.config?.adAccountId ?? conn.externalAccountId ?? "");
    const check = await verifyMetaWriteAccess(accessToken, accountId, pageId || undefined);
    if (!check.ok) {
      return {
        error: `This token cannot make changes yet. Missing: ${check.missing.join("; ")}.`,
      };
    }
    if (!discoveredIg && check.instagramUserId) discoveredIg = check.instagramUserId;
  }

  await db
    .update(integrationConnections)
    .set({
      config: {
        ...(conn.config ?? {}),
        writeEnabled,
        ...(pageId ? { pageId } : {}),
        ...(discoveredIg ? { instagramUserId: discoveredIg } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, connectionId));

  revalidatePath("/admin/integrations");
  return { ok: true };
}


export async function connectGoogleAds(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before connecting.",
    };
  }
  const parsed = googleAdsSchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    developerToken: String(formData.get("developerToken") ?? ""),
    clientId: String(formData.get("clientId") ?? ""),
    clientSecret: String(formData.get("clientSecret") ?? ""),
    refreshToken: String(formData.get("refreshToken") ?? ""),
    customerId: String(formData.get("customerId") ?? ""),
    loginCustomerId: String(formData.get("loginCustomerId") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: `Invalid Google Ads connection: ${firstIssue(parsed.error)}` };
  }

  const customerId = normalizeCustomerId(parsed.data.customerId);
  const loginCustomerId = parsed.data.loginCustomerId
    ? normalizeCustomerId(parsed.data.loginCustomerId)
    : undefined;
  const creds = {
    developerToken: parsed.data.developerToken,
    clientId: parsed.data.clientId,
    clientSecret: parsed.data.clientSecret,
    refreshToken: parsed.data.refreshToken,
  };

  try {
    // Fail fast: mint a token + read account info to confirm everything works.
    const info = await verifyGoogleAdsCredentials(creds, customerId, loginCustomerId);

    const encrypted = encryptSecret(JSON.stringify(creds));

    const [conn] = await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "google_ads",
        displayName: info.name,
        externalAccountId: customerId,
        authType: "oauth",
        encryptedCredentials: encrypted,
        config: {
          customerId,
          ...(loginCustomerId ? { loginCustomerId } : {}),
          currency: info.currency,
          timezone: info.timezone,
        },
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          encryptedCredentials: encrypted,
          config: {
            customerId,
            ...(loginCustomerId ? { loginCustomerId } : {}),
            currency: info.currency,
            timezone: info.timezone,
          },
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    try {
      await syncConnection(conn);
    } catch (err) {
      console.error("initial google ads sync failed", err);
    }
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const ga4Schema = z.object({
  brandId: z.string().uuid(),
  propertyId: z.string().trim().min(6),
});

export async function connectGa4(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = ga4Schema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    propertyId: String(formData.get("propertyId") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid GA4 connection: ${firstIssue(parsed.error)}` };
  }

  const propertyId = normalizePropertyId(parsed.data.propertyId);
  if (!propertyId) return { error: "A numeric GA4 property id is required." };

  try {
    // Fail fast: confirm the shared service account can read this property.
    // GA4 uses no per-brand secrets, so there are no credentials to encrypt.
    const info = await verifyGa4Credentials(propertyId);

    const config = await mergedConfig(parsed.data.brandId, "ga4", propertyId, {
      propertyId,
      currency: info.currency,
      timezone: info.timezone,
    });

    await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "ga4",
        displayName: info.name,
        externalAccountId: propertyId,
        authType: "service_account",
        encryptedCredentials: null,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const sendpulseSchema = z.object({
  brandId: z.string().uuid(),
  // Optional override; defaults to the brand's own domain (matches sender email).
  senderDomain: z.string().trim().optional(),
});

export async function connectSendpulse(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = sendpulseSchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    senderDomain: String(formData.get("senderDomain") ?? ""),
  });
  if (!parsed.success) {
    return { error: `Invalid SendPulse connection: ${firstIssue(parsed.error)}` };
  }

  try {
    const brand = await db.query.brands.findFirst({
      where: eq(brands.id, parsed.data.brandId),
    });
    if (!brand) return { error: "Brand not found." };

    // Normalize a domain: strip any scheme/@/path so "contact@bloomly-ph.example" or
    // "https://bloomly-ph.example/" both become "bloomly-ph.example".
    const raw = parsed.data.senderDomain || brand.domain;
    const senderDomain = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^.*@/, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();
    if (!senderDomain) return { error: "A sender domain is required." };

    // SendPulse uses one shared account-wide API key (SENDPULSE_API_KEY); there
    // are no per-brand secrets to encrypt. Fail fast if the key is missing/bad.
    await verifySendpulse();

    const config = await mergedConfig(brand.id, "sendpulse", senderDomain, {
      senderDomain,
    });

    await db
      .insert(integrationConnections)
      .values({
        brandId: brand.id,
        platform: "sendpulse",
        displayName: senderDomain,
        externalAccountId: senderDomain,
        authType: "api_key",
        encryptedCredentials: null,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

const cmsSchema = z
  .object({
    brandId: z.string().uuid(),
    host: z.string().trim().min(4),
    tenant: z.enum(CMS_TENANTS),
    email: z.string().trim().optional(),
    password: z.string().optional(),
    token: z.string().trim().optional(),
    live: z.boolean(),
  })
  .refine((v) => !!v.token || (!!v.email && !!v.password), {
    message: "Enter the CMS email and password, or an API token.",
  });

/**
 * Connect a brand to its storefront CMS (the `/mcp/cms` endpoint). Nothing
 * syncs: chats read it live and propose changes. With an email and password the
 * app logs in again by itself whenever the token expires; a pasted token is
 * used as is until it stops working.
 */
export async function connectCms(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  if (!encryptionConfigured()) {
    return {
      error:
        "INTEGRATIONS_ENC_KEY is not set — add a 32-byte base64 key before connecting.",
    };
  }
  const parsed = cmsSchema.safeParse({
    brandId: String(formData.get("brandId") ?? ""),
    host: String(formData.get("host") ?? ""),
    tenant: String(formData.get("tenant") ?? ""),
    email: String(formData.get("email") ?? "") || undefined,
    password: String(formData.get("password") ?? "") || undefined,
    token: String(formData.get("token") ?? "") || undefined,
    live: formData.get("live") === "on",
  });
  if (!parsed.success) {
    return { error: `Invalid CMS connection: ${firstIssue(parsed.error)}` };
  }

  try {
    const host = normalizeCmsHost(parsed.data.host);
    const creds: CmsCredentials = parsed.data.token
      ? { token: parsed.data.token }
      : { email: parsed.data.email!, password: parsed.data.password! };
    await verifyCmsCredentials(host, parsed.data.tenant, creds);

    const encrypted = encryptSecret(JSON.stringify(creds));
    const config = await mergedConfig(parsed.data.brandId, "cms", parsed.data.tenant, {
      host,
      tenant: parsed.data.tenant,
      live: parsed.data.live,
    });
    const displayName = `${host.replace(/^https:\/\//, "")} (${parsed.data.tenant})`;

    // One CMS per brand: the storefront code is the natural key, so reconnecting
    // with a new host or new credentials replaces the old connection.
    await db
      .insert(integrationConnections)
      .values({
        brandId: parsed.data.brandId,
        platform: "cms",
        displayName,
        externalAccountId: parsed.data.tenant,
        authType: "token" in creds ? "api_key" : "login",
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        createdById: admin.id,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          displayName,
          authType: "token" in creds ? "api_key" : "login",
          encryptedCredentials: encrypted,
          config,
          status: "connected",
          syncError: null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    return toErr(err);
  }

  revalidatePath("/admin/integrations");
  return OK;
}

/**
 * Finish a TikTok advertiser grant the callback parked in a cookie: connect the
 * ad accounts the admin ticked to the brand they started from. Only the admin
 * who started the grant can finish it, and the cookie is cleared either way.
 */
export async function connectTiktokAds(formData: FormData) {
  const admin = await requireAdmin();
  const jar = await cookies();
  const pending = openPending(jar.get(PENDING_COOKIE)?.value);
  jar.delete({ name: PENDING_COOKIE, path: "/admin/integrations" });
  if (!pending || pending.userId !== admin.id) {
    redirect("/admin/integrations?tiktok=error&reason=" + encodeURIComponent("The TikTok grant expired. Connect again."));
  }
  const ids = formData.getAll("advertiserId").map(String);
  if (ids.length === 0) {
    redirect("/admin/integrations?tiktok=error&reason=" + encodeURIComponent("No ad account was selected."));
  }
  const conns = await createAdsConnections(pending, ids);
  const failed: string[] = [];
  for (const conn of conns) {
    const r = await syncConnection(conn).catch((err) => ({ ok: false, error: String(err) }));
    if (!r.ok) failed.push(conn.displayName);
  }
  revalidatePath("/admin/integrations");
  const names = conns.map((c) => c.displayName).join(", ");
  redirect(
    "/admin/integrations?tiktok=connected&account=" +
      encodeURIComponent(names) +
      (failed.length ? "&reason=" + encodeURIComponent(`First sync failed for ${failed.join(", ")}.`) : ""),
  );
}

export async function syncNow(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const conn = await db.query.integrationConnections.findFirst({
    where: eq(integrationConnections.id, id),
  });
  // syncConnection records its own failure on the row; guard so a throw here
  // never escapes to the error overlay.
  if (conn) {
    try {
      await syncConnection(conn);
    } catch (err) {
      console.error("manual sync failed", err);
    }
  }
  revalidatePath("/admin/integrations");
}

export async function setConnectionStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const disconnect = formData.get("disconnect") === "true";
  if (!id) return;
  await db
    .update(integrationConnections)
    .set({ status: disconnect ? "disconnected" : "connected", updatedAt: new Date() })
    .where(eq(integrationConnections.id, id));
  revalidatePath("/admin/integrations");
}

export async function deleteConnection(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(integrationConnections).where(eq(integrationConnections.id, id));
  revalidatePath("/admin/integrations");
}

/**
 * Re-encrypt every stored secret with the current write key.
 *
 * This exists as a button because on Vercel a secret can be written but never
 * read back, so the key being rotated away from lives in exactly one usable
 * place: this running deployment. A local script cannot reach it, and asking
 * anyone to paste the old value somewhere is asking for what cannot be done.
 *
 * Dry by default. `apply=true` writes.
 */
export async function rotateEncryptionKey(
  _prev: RotationState,
  formData: FormData,
): Promise<RotationState> {
  await requireAdmin();
  const apply = formData.get("apply") === "true";

  try {
    const report = await rotateStoredSecrets({ apply });
    const lines = report.outcomes.map(
      (o) => `${o.status === "unreadable" ? "UNREADABLE" : o.status}: ${o.label}`,
    );
    return {
      ok: true,
      applied: report.applied,
      rewritten: report.rewritten,
      unreadable: report.unreadable,
      writeKey: rotationInFlight()
        ? "INTEGRATIONS_ENC_KEY_NEXT"
        : "INTEGRATIONS_ENC_KEY",
      keyCount: decryptionKeyCount(),
      lines,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Rotation failed.",
    };
  }
}
