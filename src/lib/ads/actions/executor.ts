/**
 * Carrying out an approved change against the live ad account.
 *
 * This is the only code in the app that writes to Meta. Everything upstream
 * proposes; a person approves; this runs. Six things stand between an approved
 * row and a changed account, and each exists because of a specific way this
 * goes wrong:
 *
 *   kill switches   env ADS_WRITES_ENABLED and the connection's writeEnabled.
 *                   Either one off stops every write, which is what you reach
 *                   for when something is misbehaving at 2am.
 *
 *   account gate    the account this connection names must be claimed by this
 *                   brand and no other. Authorisation runs on brands, so two
 *                   brands sharing an account means a grant for one spends the
 *                   other's budget. See `account-guard.ts`.
 *
 *   claiming        a conditional UPDATE, not a read-then-write. The database
 *                   driver has no interactive transactions, so two concurrent
 *                   runs must not be able to both believe they own a row.
 *
 *   staleness       the live status is re-read and compared against the status
 *                   held when the action was proposed. Between a rule
 *                   proposing a pause and a human approving it, somebody may
 *                   have paused, edited or re-activated the ad in Ads Manager,
 *                   and their newer decision must win.
 *
 *   verification    a GET after the write. A 200 means Meta accepted the call,
 *                   not that the ad is no longer delivering.
 *
 *   retry policy    only Meta's own transient errors and rate limits are
 *                   retried. A permissions failure retried is just the next
 *                   window's quota spent reaching the same conclusion.
 *
 * The retry policy has one more rule, and it is the one that is easy to get
 * wrong: a write whose *reply* failed to arrive is not a failed write. A
 * timeout or a dropped connection can happen after Meta has already applied
 * the change, so "try it again" and "it did not happen" are different claims
 * and only the second justifies a retry. Pausing is safe either way, because
 * sending the same status twice is a no-op. Creating is not: the same request
 * sent twice is two ads. So an ambiguous failure is retried only for the
 * operations that are safe to repeat, and otherwise ends in `outcome_unknown`
 * for a person to resolve against the account.
 */
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adActions,
  adDrafts,
  adNotes,
  brands,
  integrationConnections,
} from "@/db/schema";
import { redactError } from "@/lib/integrations/http";
import {
  MetaApiError,
  accountIdOf,
  fetchEntityFields,
  fetchEntityStatus,
  resolveMetaTarget,
  setAdStatus,
} from "@/lib/integrations/meta/client";
import type { DbConnection } from "@/lib/integrations/types";
import { accountGate, type AccountClaim } from "./account-guard";
import type { WriteResource } from "./allowlist";
import {
  createAd,
  createCreative,
  createStructure,
  findAdByTag,
  updateEntity,
  uploadImage,
  uploadVideo,
  type DraftAsset,
} from "./meta-writes";
import { openKeyFor } from "./permissions";
import { routeWriteFailure } from "./retry";

export type ExecuteResult = {
  id: string;
  state: string;
  detail: string;
};

/** Whether writes are permitted at all, and why not when they are not. */
export function writesEnabled(conn: DbConnection): {
  ok: boolean;
  reason: string;
} {
  if (process.env.ADS_WRITES_ENABLED !== "true") {
    return {
      ok: false,
      reason:
        "Writes to Meta are switched off for this deployment " +
        "(ADS_WRITES_ENABLED is not 'true').",
    };
  }
  if (conn.config?.writeEnabled !== true) {
    return {
      ok: false,
      reason:
        "Writes are not enabled for this ad account. Turn them on in " +
        "Admin → Integrations once the token has ads_management.",
    };
  }
  return { ok: true, reason: "" };
}

/**
 * Every brand's claim on a Meta ad account.
 *
 * All of them, not the live ones: `accountGate` treats a disconnected row as a
 * claim too, and filtering here would quietly undo that.
 */
export async function loadAccountClaims(): Promise<AccountClaim[]> {
  const rows = await db
    .select({
      brandId: integrationConnections.brandId,
      brandName: brands.name,
      config: integrationConnections.config,
      externalAccountId: integrationConnections.externalAccountId,
    })
    .from(integrationConnections)
    .innerJoin(brands, eq(brands.id, integrationConnections.brandId))
    .where(eq(integrationConnections.platform, "meta"));

  return rows.map((row) => ({
    brandId: row.brandId,
    brandName: row.brandName,
    adAccountId: String(row.config?.adAccountId ?? row.externalAccountId ?? ""),
  }));
}

/**
 * Both gates, in the order a person would ask them.
 *
 * Is writing switched on at all, and is this account unambiguously this
 * brand's. Callers that already hold the claims pass them in; the executor
 * loads its own, because it is the control and must not depend on a caller
 * having remembered to.
 */
export function writeGateFor(
  conn: DbConnection,
  claims: AccountClaim[],
): { ok: boolean; reason: string } {
  const enabled = writesEnabled(conn);
  if (!enabled.ok) return enabled;
  return accountGate(accountIdOf(conn), conn.brandId, claims);
}

/**
 * Claim one approved action for execution.
 *
 * The WHERE clause carries the state, so the row is only claimed if it is still
 * approved at the moment of writing. Two runs racing means one gets the row and
 * the other gets nothing, rather than both proceeding on a stale read.
 */
async function claim(actionId: string): Promise<boolean> {
  const claimed = await db
    .update(adActions)
    .set({
      state: "executing",
      claimedAt: new Date(),
      attempts: sql`${adActions.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(adActions.id, actionId), eq(adActions.state, "approved")))
    .returning({ id: adActions.id });
  return claimed.length > 0;
}

async function finish(
  actionId: string,
  state: string,
  fields: {
    detail?: string;
    error?: string;
    metaResponse?: Record<string, unknown>;
    kind?: string;
    entityId?: string;
  },
): Promise<ExecuteResult> {
  await db
    .update(adActions)
    .set({
      state,
      error: fields.error ?? null,
      metaResponse: fields.metaResponse ?? null,
      openKey: openKeyFor(
        state as never,
        fields.kind ?? "",
        fields.entityId ?? "",
      ),
      updatedAt: new Date(),
    })
    .where(eq(adActions.id, actionId));
  return { id: actionId, state, detail: fields.detail ?? "" };
}

/**
 * Execute one approved action.
 *
 * Returns rather than throws for every outcome a human should read: refused,
 * stale, failed. An exception here would just be a 500 on the approve button.
 */
export async function executeAction(actionId: string): Promise<ExecuteResult> {
  const action = await db.query.adActions.findFirst({
    where: eq(adActions.id, actionId),
  });
  if (!action) return { id: actionId, state: "missing", detail: "No such action." };

  const conn = (await db.query.integrationConnections.findFirst({
    where: eq(integrationConnections.id, action.connectionId),
  })) as DbConnection | undefined;
  if (!conn) {
    return finish(actionId, "failed", {
      error: "The ad account connection is gone.",
      kind: action.kind,
      entityId: action.entityId,
    });
  }

  // Both gates, loaded here rather than trusted from the caller: this is the
  // last thing between an approved row and a changed account.
  const gate = writeGateFor(conn, await loadAccountClaims());
  if (!gate.ok) {
    // Left approved, not failed: the change is still wanted, it simply cannot
    // be made yet. Turning the switch on, or fixing the connection, and
    // re-running picks it up.
    return { id: actionId, state: action.state, detail: gate.reason };
  }

  if (!(await claim(actionId))) {
    return {
      id: actionId,
      state: action.state,
      detail:
        action.state === "executing"
          ? "Already being executed."
          : `Cannot execute an action that is ${action.state}.`,
    };
  }

  const target = resolveMetaTarget(conn);
  const payload = (action.payload ?? {}) as { expectedStatus?: string };

  try {
    if (action.kind === "create_ad") {
      return await executeCreateAd(actionId, action, conn, target);
    }
    if (action.kind === "set_budget" || action.kind === "set_schedule") {
      return await executeFieldWrite(actionId, action, target);
    }
    if (action.kind === "create_structure") {
      return await executeCreateStructure(actionId, action, target);
    }
    if (action.kind !== "pause_ad" && action.kind !== "activate_ad") {
      return await finish(actionId, "failed", {
        error: `This executor does not handle ${action.kind}.`,
        kind: action.kind,
        entityId: action.entityId,
      });
    }

    // --- staleness ---
    const before = await fetchEntityStatus(target, action.entityId);
    if (!before) {
      return await finish(actionId, "failed", {
        error: "Meta did not return this ad. It may have been deleted.",
        kind: action.kind,
        entityId: action.entityId,
      });
    }
    const wanted = action.kind === "pause_ad" ? "PAUSED" : "ACTIVE";
    if (before.status === wanted) {
      // Someone got there first. Not a failure, and not something to redo.
      return await finish(actionId, "done", {
        detail: `Already ${wanted.toLowerCase()} in Ads Manager.`,
        metaResponse: { alreadyApplied: true, status: before.status },
        kind: action.kind,
        entityId: action.entityId,
      });
    }
    if (payload.expectedStatus && before.status !== payload.expectedStatus) {
      return await finish(actionId, "stale", {
        detail:
          `This was proposed when the ad was ${payload.expectedStatus}, and it ` +
          `is now ${before.status}. Someone changed it since, so it has been ` +
          "left alone.",
        kind: action.kind,
        entityId: action.entityId,
      });
    }

    // --- the write ---
    const response = await setAdStatus(target, action.entityId, wanted);

    // --- verification ---
    const after = await fetchEntityStatus(target, action.entityId);
    if (after && after.status !== wanted) {
      return await finish(actionId, "failed", {
        error:
          `Meta accepted the change but the ad still reads ${after.status}.`,
        metaResponse: { ...response, verifiedStatus: after.status },
        kind: action.kind,
        entityId: action.entityId,
      });
    }

    await db.insert(adNotes).values({
      connectionId: conn.id,
      brandId: conn.brandId,
      level: action.level,
      entityId: action.entityId,
      body:
        `${wanted === "PAUSED" ? "Paused" : "Activated"} from Second Brain. ` +
        (action.reason || "No reason recorded."),
      source: "system",
      authorId: action.decidedById,
    });

    return await finish(actionId, "done", {
      detail: `Ad is now ${wanted.toLowerCase()}.`,
      metaResponse: {
        ...response,
        verifiedStatus: after?.status ?? wanted,
        effectiveStatus: after?.effectiveStatus ?? "",
      },
      kind: action.kind,
      entityId: action.entityId,
    });
  } catch (err) {
    const meta = err instanceof MetaApiError ? err : null;
    const message = meta
      ? `${meta.message}${meta.userMessage ? ` — ${meta.userMessage}` : ""} (code ${meta.code})`
      : redactError(err);

    const route = routeWriteFailure(err, {
      actionKind: action.kind,
      attempts: action.attempts,
    });

    if (route === "outcome_unknown") {
      return await finish(actionId, "outcome_unknown", {
        error: message,
        detail:
          "The request left but no reply came back, so we do not know whether " +
          "Meta applied it. Check this " +
          (action.kind === "create_ad" ? "ad set" : "ad") +
          " in Ads Manager before queueing anything else for it; " +
          (action.kind === "create_ad"
            ? "anything a half-finished attempt made carries [pb:] and the draft id in its name."
            : "nothing has been retried."),
        kind: action.kind,
        entityId: action.entityId,
      });
    }

    // Back to approved so the next sweep tries. Either Meta refused in a way
    // that may not recur (a rate limit), or the reply was lost on an operation
    // that is safe to send again.
    if (route === "retry") {
      await db
        .update(adActions)
        .set({ state: "approved", error: message, updatedAt: new Date() })
        .where(eq(adActions.id, actionId));
      return {
        id: actionId,
        state: "approved",
        detail: `Temporary Meta error, will retry: ${message}`,
      };
    }

    return await finish(actionId, "failed", {
      error: message,
      kind: action.kind,
      entityId: action.entityId,
    });
  }
}

/**
 * Turn an approved draft into a paused ad.
 *
 * Creation is the one action that is not safe to repeat, so each step records
 * what it achieved on the draft before the next begins. A request that dies
 * after Meta accepted it leaves its work findable: image hashes on the draft,
 * and the ad itself by the tag in its name.
 */
async function executeCreateAd(
  actionId: string,
  action: typeof adActions.$inferSelect,
  conn: DbConnection,
  target: ReturnType<typeof resolveMetaTarget>,
): Promise<ExecuteResult> {
  const payload = (action.payload ?? {}) as { draftId?: string };
  if (!payload.draftId) {
    return finish(actionId, "failed", {
      error: "This action has no draft attached.",
      kind: action.kind,
    });
  }

  const draft = await db.query.adDrafts.findFirst({
    where: eq(adDrafts.id, payload.draftId),
  });
  if (!draft) {
    return finish(actionId, "failed", {
      error: "The draft is gone.",
      kind: action.kind,
    });
  }

  const pageId = String(conn.config?.pageId ?? "");
  if (!pageId) {
    return finish(actionId, "failed", {
      error:
        "No Facebook Page is set for this ad account. An ad cannot be created " +
        "without one; set it in Admin → Integrations.",
      kind: action.kind,
    });
  }

  const tag = draft.id.slice(0, 8);

  // Somebody, possibly a previous attempt, may already have made this ad.
  const existing = await findAdByTag(target, draft.targetAdSetId, tag);
  if (existing) {
    await db
      .update(adDrafts)
      .set({ status: "uploaded", metaAdId: existing, uploadedAt: new Date() })
      .where(eq(adDrafts.id, draft.id));
    return finish(actionId, "done", {
      detail: "This ad already existed in the ad set; recorded rather than remade.",
      metaResponse: { adId: existing, deduplicated: true },
      kind: action.kind,
      entityId: existing,
    });
  }

  const assets = (draft.assets ?? []) as unknown as DraftAsset[];
  if (assets.length === 0) {
    return finish(actionId, "failed", {
      error: "The draft has no creative attached.",
      kind: action.kind,
    });
  }

  // Upload anything not yet uploaded, saving each hash as it lands so a retry
  // does not pay for the same upload twice.
  const uploaded: DraftAsset[] = [];
  for (const asset of assets) {
    if (asset.metaHash || asset.metaVideoId) {
      uploaded.push(asset);
      continue;
    }
    if (asset.kind === "video") {
      const videoId = await uploadVideo(target, asset.url);
      uploaded.push({ ...asset, metaVideoId: videoId });
    } else {
      const hash = await uploadImage(target, asset.url);
      uploaded.push({ ...asset, metaHash: hash });
    }
    await db
      .update(adDrafts)
      .set({ assets: uploaded as unknown as Record<string, unknown>[] })
      .where(eq(adDrafts.id, draft.id));
  }

  const input = {
    adSetId: draft.targetAdSetId,
    name: draft.concept || "Untitled ad",
    headline: draft.headline,
    primaryText: draft.primaryText,
    description: draft.description,
    callToAction: draft.callToAction,
    linkUrl: draft.linkUrl,
    pageId,
    instagramUserId: String(conn.config?.instagramUserId ?? "") || undefined,
    assets: uploaded,
    // So a creative made by an attempt that then lost its reply is findable by
    // name, the same way the ad already is.
    draftTag: tag,
  };

  const creativeId = draft.metaCreativeId ?? (await createCreative(target, input));
  if (!draft.metaCreativeId) {
    await db
      .update(adDrafts)
      .set({ metaCreativeId: creativeId })
      .where(eq(adDrafts.id, draft.id));
  }

  // Ask Meta whether this would be accepted before making anything. Placement
  // customization has requirements the ad set must already satisfy, and a
  // refusal here costs nothing.
  await createAd(
    target,
    { adSetId: draft.targetAdSetId, name: input.name, creativeId, draftTag: tag },
    { validateOnly: true },
  );

  const created = await createAd(target, {
    adSetId: draft.targetAdSetId,
    name: input.name,
    creativeId,
    draftTag: tag,
  });

  await db
    .update(adDrafts)
    .set({
      status: "uploaded",
      metaAdId: created.id ?? null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(adDrafts.id, draft.id));

  return finish(actionId, "done", {
    detail: `Created as a paused ad. Turn it on in Ads Manager when ready.`,
    metaResponse: { adId: created.id, creativeId },
    kind: action.kind,
    entityId: created.id ?? "",
  });
}

/**
 * Create a campaign and its first ad set, in that order.
 *
 * The campaign id is recorded on the action before the ad set is attempted, so
 * a failure at the second step leaves a findable campaign rather than an
 * orphan. Nothing retries: `routeWriteFailure` refuses to repeat a create, and
 * a lost reply here ends as `outcome_unknown` with the campaign id already
 * written down if the first call got that far.
 */
async function executeCreateStructure(
  actionId: string,
  action: typeof adActions.$inferSelect,
  target: ReturnType<typeof resolveMetaTarget>,
): Promise<ExecuteResult> {
  const payload = (action.payload ?? {}) as {
    campaign?: Record<string, string | number>;
    adset?: Record<string, string | number>;
    campaignId?: string;
  };
  if (!payload.campaign || !payload.adset) {
    return finish(actionId, "failed", {
      error: "This action carries no plan to build.",
      kind: action.kind,
    });
  }

  // Already made on a previous attempt: never build it twice.
  let campaignId = payload.campaignId ?? "";

  if (!campaignId) {
    await createStructure(target, "campaign", payload.campaign, {
      validateOnly: true,
    });
    const campaign = await createStructure(target, "campaign", payload.campaign);
    if (!campaign.id) {
      return finish(actionId, "outcome_unknown", {
        error: "Meta accepted the campaign but returned no id.",
        detail:
          "A campaign may exist without this app knowing its id. Check Ads " +
          "Manager for one matching the name before trying again.",
        kind: action.kind,
      });
    }
    campaignId = campaign.id;
    // Written down before the ad set is attempted, so a failure at the next
    // step cannot lose it.
    await db
      .update(adActions)
      .set({
        payload: { ...payload, campaignId },
        updatedAt: new Date(),
      })
      .where(eq(adActions.id, actionId));
  }

  const adsetFields = { ...payload.adset, campaign_id: campaignId };
  await createStructure(target, "adset", adsetFields, { validateOnly: true });
  const adset = await createStructure(target, "adset", adsetFields);

  return finish(actionId, "done", {
    detail:
      `Created paused. Campaign ${campaignId}` +
      (adset.id ? `, ad set ${adset.id}.` : ", ad set id not returned.") +
      " It has no ads yet and delivers nothing until somebody turns it on.",
    metaResponse: { campaignId, adSetId: adset.id ?? null },
    kind: action.kind,
    entityId: campaignId,
  });
}

/**
 * Apply a budget or schedule change to one entity.
 *
 * The staleness check here compares the fields being written rather than only
 * `status`, because that is what "somebody already changed this" means for a
 * budget. A proposal made when an ad set was on 50/day, approved an hour later
 * when a person has moved it to 200, is not a proposal about the same thing any
 * more and is left alone.
 *
 * The entity written to is whatever the proposal resolved, not the entity the
 * alert was about: under campaign budget optimisation an ad set's money lives
 * on its campaign, and this account has both shapes in it.
 */
async function executeFieldWrite(
  actionId: string,
  action: typeof adActions.$inferSelect,
  target: ReturnType<typeof resolveMetaTarget>,
): Promise<ExecuteResult> {
  const payload = (action.payload ?? {}) as {
    resource?: WriteResource;
    fields?: Record<string, string | number>;
    expected?: Record<string, string | number | null>;
  };
  const resource = payload.resource;
  const fields = payload.fields ?? {};

  if (!resource || Object.keys(fields).length === 0) {
    return finish(actionId, "failed", {
      error: "This action carries no fields to write.",
      kind: action.kind,
      entityId: action.entityId,
    });
  }

  // --- staleness, on the fields this actually writes ---
  if (payload.expected && Object.keys(payload.expected).length > 0) {
    const live = await fetchEntityFields(
      target,
      action.entityId,
      Object.keys(payload.expected),
    );
    if (!live) {
      return finish(actionId, "failed", {
        error: "Meta did not return this entity. It may have been deleted.",
        kind: action.kind,
        entityId: action.entityId,
      });
    }
    const moved = Object.entries(payload.expected).filter(
      ([name, was]) => String(live[name] ?? "") !== String(was ?? ""),
    );
    if (moved.length > 0) {
      const what = moved
        .map(([name, was]) => `${name} was ${was ?? "unset"}, is now ${live[name] ?? "unset"}`)
        .join("; ");
      return finish(actionId, "stale", {
        detail: `Somebody changed this since it was proposed (${what}), so it has been left alone.`,
        kind: action.kind,
        entityId: action.entityId,
      });
    }
  }

  // Ask Meta whether it would take this before making the change. A refusal
  // here costs nothing and is a far better error than a half-applied set.
  await updateEntity(target, resource, action.entityId, fields, {
    validateOnly: true,
  });

  const response = await updateEntity(target, resource, action.entityId, fields);

  // --- verification: a 200 is Meta accepting the call, not the value landing ---
  const after = await fetchEntityFields(target, action.entityId, Object.keys(fields));
  const wrong = Object.entries(fields).filter(
    ([name, wanted]) => after && String(after[name] ?? "") !== String(wanted),
  );
  if (after && wrong.length > 0) {
    return finish(actionId, "failed", {
      error:
        "Meta accepted the change but the entity still reads " +
        wrong.map(([n]) => `${n}=${after[n] ?? "unset"}`).join(", "),
      metaResponse: { ...response, verified: after },
      kind: action.kind,
      entityId: action.entityId,
    });
  }

  return finish(actionId, "done", {
    detail: Object.entries(fields)
      .map(([name, value]) => `${name} set to ${value}`)
      .join(", "),
    metaResponse: { ...response, verified: after ?? {} },
    kind: action.kind,
    entityId: action.entityId,
  });
}

/**
 * Finish anything left approved or stuck executing.
 *
 * An action stuck in `executing` is one whose request died mid-flight, which is
 * why it is reconciled with a GET rather than re-sent: pause is safe to repeat,
 * but the same sweep will later handle ad creation, which is not.
 */
export async function sweepActions(connectionId: string): Promise<ExecuteResult[]> {
  const pending = await db
    .select({ id: adActions.id })
    .from(adActions)
    .where(
      and(
        eq(adActions.connectionId, connectionId),
        inArray(adActions.state, ["approved"]),
      ),
    )
    .limit(25);

  const out: ExecuteResult[] = [];
  for (const row of pending) {
    out.push(await executeAction(row.id));
  }
  return out;
}
