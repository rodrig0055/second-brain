import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { cmsChangeRequests, integrationConnections, users } from "@/db/schema";
import type { DbConnection } from "../types";
import { cmsCallKind, describeCmsCall, type CmsCallKind } from "./calls";
import { callCmsTool, cmsTarget } from "./client";

/**
 * Proposed CMS changes. A chat saves one per write call; the card applies it.
 * Every status change is a conditional update, so a double click or two people
 * at once cannot apply the same change twice.
 */

export async function proposeCmsChange(input: {
  brandId: string;
  conn: DbConnection;
  tool: string;
  args: Record<string, unknown>;
  note?: string;
  userId: string;
}): Promise<{ cmsRequestId: string; summary: string; kind: CmsCallKind }> {
  const { host, tenant } = cmsTarget(input.conn);
  const summary = describeCmsCall(input.tool, input.args);
  const [row] = await db
    .insert(cmsChangeRequests)
    .values({
      brandId: input.brandId,
      connectionId: input.conn.id,
      host,
      tenant,
      tool: input.tool,
      args: input.args,
      summary,
      note: input.note?.trim() || null,
      createdBy: input.userId,
    })
    .returning({ id: cmsChangeRequests.id });
  return { cmsRequestId: row.id, summary, kind: cmsCallKind(input.tool, input.args) };
}

export type CmsRequestView = {
  id: string;
  brandId: string;
  tool: string;
  kind: CmsCallKind;
  summary: string;
  note: string | null;
  args: Record<string, unknown>;
  host: string;
  tenant: string;
  live: boolean;
  status: string;
  result: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export async function getCmsRequestView(id: string): Promise<CmsRequestView | null> {
  const creator = alias(users, "creator");
  const decider = alias(users, "decider");
  const [row] = await db
    .select({
      r: cmsChangeRequests,
      createdByName: creator.name,
      decidedByName: decider.name,
      config: integrationConnections.config,
    })
    .from(cmsChangeRequests)
    .leftJoin(creator, eq(creator.id, cmsChangeRequests.createdBy))
    .leftJoin(decider, eq(decider.id, cmsChangeRequests.decidedBy))
    .leftJoin(integrationConnections, eq(integrationConnections.id, cmsChangeRequests.connectionId))
    .where(eq(cmsChangeRequests.id, id));
  if (!row) return null;
  const r = row.r;
  return {
    id: r.id,
    brandId: r.brandId,
    tool: r.tool,
    kind: cmsCallKind(r.tool, r.args),
    summary: r.summary,
    note: r.note,
    args: r.args,
    host: r.host,
    tenant: r.tenant,
    live: row.config?.live === true,
    status: r.status,
    result: r.result,
    errorMessage: r.errorMessage,
    createdBy: r.createdBy,
    createdByName: row.createdByName,
    decidedByName: row.decidedByName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function applyCmsRequest(id: string, userId: string): Promise<void> {
  const [req] = await db
    .update(cmsChangeRequests)
    .set({ status: "applying", decidedBy: userId, decidedAt: new Date() })
    .where(and(eq(cmsChangeRequests.id, id), eq(cmsChangeRequests.status, "pending")))
    .returning();
  if (!req) throw new Error("This change is not pending any more.");

  const fail = (message: string) =>
    db
      .update(cmsChangeRequests)
      .set({ status: "failed", errorMessage: message.slice(0, 2000) })
      .where(eq(cmsChangeRequests.id, id));

  const conn = req.connectionId
    ? await db.query.integrationConnections.findFirst({
        where: eq(integrationConnections.id, req.connectionId),
      })
    : undefined;
  if (!conn || conn.status !== "connected") {
    await fail("The CMS connection was removed or disconnected after this change was proposed.");
    return;
  }
  // The card promised a storefront; never send the change somewhere else.
  const target = cmsTarget(conn);
  if (target.host !== req.host || target.tenant !== req.tenant) {
    await fail(`The CMS connection now points at ${target.host} (${target.tenant}), not ${req.host} (${req.tenant}). Ask the chat again.`);
    return;
  }

  try {
    const res = await callCmsTool(conn, req.tool, req.args);
    await db
      .update(cmsChangeRequests)
      .set(
        res.ok
          ? { status: "applied", result: res.text.slice(0, 20_000) }
          : { status: "failed", result: res.text.slice(0, 20_000), errorMessage: res.text.slice(0, 2000) },
      )
      .where(eq(cmsChangeRequests.id, id));
  } catch (e) {
    await fail(e instanceof Error ? e.message : String(e));
  }
}

export async function rejectCmsRequest(id: string, userId: string): Promise<void> {
  const [req] = await db
    .update(cmsChangeRequests)
    .set({ status: "rejected", decidedBy: userId, decidedAt: new Date() })
    .where(and(eq(cmsChangeRequests.id, id), eq(cmsChangeRequests.status, "pending")))
    .returning({ id: cmsChangeRequests.id });
  if (!req) throw new Error("This change is not pending any more.");
}
