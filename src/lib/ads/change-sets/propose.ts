/**
 * Turning what the rules found into something a person can say yes to.
 *
 * The alerts have existed for a while and have always stopped short: a rule
 * reports that an ad set is at 3x its target CIR, and then somebody reads that,
 * opens Ads Manager and does the arithmetic themselves. This is the step that
 * was missing, and it is the whole point of the pipeline being managed from
 * here rather than watched from here.
 *
 * Three things keep it honest.
 *
 * It only proposes from CONFIRMED rules. An unconfirmed threshold is
 * Acme Florals PH's number wearing another brand's name, and a proposal built on
 * one is a confident-sounding guess. Unconfirmed alerts still show on the
 * alerts tab, where a person reads them as the estimates they are.
 *
 * It proposes pausing, never raising. Every kill rule detects something going
 * wrong, and the correct response to "this is losing money" is to stop it, not
 * to guess where the money should go instead. Moving budget needs a reason to
 * believe somewhere else is better, which is a different pass with different
 * evidence.
 *
 * It refuses to propose the same thing twice. An entity with an open action or
 * a set still pending is left alone: the specialist has already been asked.
 */
import "server-only";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adActions,
  adAlerts,
  adChangeSets,
  adEntities,
  metricsDaily,
} from "@/db/schema";
import type { DbConnection } from "@/lib/integrations/types";
import {
  DEFAULT_GUARDRAILS,
  checkGuardrails,
  type Guardrails,
  type ProposedChange,
} from "@/lib/ads/actions/guardrails";
import { fromMinorUnits } from "@/lib/integrations/meta/entities";

/** Kill rules whose answer is "stop this". All of them, today. */
const PAUSE_KINDS = new Set([
  "cpa_multiple",
  "cir_over_target",
  "cost_per_warm",
  "lpvr_floor",
  "spend_min_conversions",
  "frequency_over",
]);

export type ProposalResult = {
  proposed: number;
  skipped: { entity: string; why: string }[];
  setId: string | null;
};

/**
 * Propose pauses for everything the confirmed rules are certain about.
 *
 * One set per run rather than one per alert. Six ads failing the same rule on
 * the same morning is one judgement about one campaign, and six cards would
 * make the specialist read the same reasoning six times.
 */
export async function proposeFromAlerts(
  conn: DbConnection,
  options: { guardrails?: Partial<Guardrails> } = {},
): Promise<ProposalResult> {
  const rails: Guardrails = { ...DEFAULT_GUARDRAILS, ...options.guardrails };
  const currency = String(conn.config?.currency ?? "USD");
  const skipped: { entity: string; why: string }[] = [];

  const alerts = await db
    .select()
    .from(adAlerts)
    .where(
      and(
        eq(adAlerts.connectionId, conn.id),
        eq(adAlerts.state, "open"),
        eq(adAlerts.confirmed, true),
      ),
    )
    .orderBy(desc(adAlerts.severity), desc(adAlerts.lastSeenAt))
    .limit(rails.maxEntities * 2);

  if (alerts.length === 0) return { proposed: 0, skipped, setId: null };

  // Anything already in front of somebody. Asking twice about one ad is how a
  // queue stops being read.
  const open = await db
    .select({ entityId: adActions.entityId })
    .from(adActions)
    .where(
      and(
        eq(adActions.connectionId, conn.id),
        inArray(adActions.state, ["pending", "approved", "executing"]),
      ),
    );
  const alreadyAsked = new Set(open.map((r) => r.entityId));

  const candidates = alerts.filter((a) => PAUSE_KINDS.has(a.kind));
  const changes: ProposedChange[] = [];
  const rows: {
    alert: typeof adAlerts.$inferSelect;
    status: string;
  }[] = [];

  for (const alert of candidates) {
    if (rows.length >= rails.maxEntities) {
      skipped.push({ entity: alert.entityName, why: "set is already full" });
      continue;
    }
    if (alreadyAsked.has(alert.entityId)) {
      skipped.push({ entity: alert.entityName, why: "already waiting on a decision" });
      continue;
    }

    // The mirror, not the alert, decides whether this is worth proposing: an
    // alert is about a window that has closed, and the entity may have been
    // paused since by a person.
    const [entity] = await db
      .select()
      .from(adEntities)
      .where(
        and(
          eq(adEntities.connectionId, conn.id),
          eq(adEntities.level, alert.level),
          eq(adEntities.entityId, alert.entityId),
        ),
      )
      .limit(1);

    if (!entity) {
      skipped.push({ entity: alert.entityName, why: "not in the mirror yet" });
      continue;
    }
    if (entity.status !== "ACTIVE") {
      skipped.push({ entity: alert.entityName, why: `already ${entity.status.toLowerCase()}` });
      continue;
    }

    rows.push({ alert, status: entity.status });
    changes.push({
      kind: "set_status",
      level: alert.level as "campaign" | "adset" | "ad",
      entityId: alert.entityId,
      entityName: alert.entityName || entity.name,
      lastChangedAt: entity.metaUpdatedAt,
    });
  }

  if (rows.length === 0) return { proposed: 0, skipped, setId: null };

  const trailing = await trailingDailySpend(conn.brandId);
  const verdict = checkGuardrails(changes, rails, {
    trailingDailySpend: trailing,
    currency,
    minorPerMajor: fromMinorUnits("100", currency) === 1 ? 100 : 1,
  });
  if (!verdict.ok) {
    // Refused as a set rather than trimmed to fit, for the same reason applying
    // is: half a proposal is a shape nobody chose.
    return {
      proposed: 0,
      setId: null,
      skipped: [
        ...skipped,
        ...verdict.breaches.map((why) => ({ entity: "the set", why })),
      ],
    };
  }

  const worst = rows[0].alert;
  const [set] = await db
    .insert(adChangeSets)
    .values({
      connectionId: conn.id,
      brandId: conn.brandId,
      source: "rule",
      state: "pending",
      reason:
        rows.length === 1
          ? `Pause ${worst.entityName}: ${worst.message}`
          : `Pause ${rows.length} entities the confirmed rules flagged`,
      expectation:
        "Spend on these stops. Nothing else changes, so the rest of the " +
        "account's numbers should be unaffected.",
      guardrails: { ...rails, currency, trailingDailySpend: trailing },
    })
    .returning({ id: adChangeSets.id });

  for (const { alert, status } of rows) {
    await db.insert(adActions).values({
      connectionId: conn.id,
      brandId: conn.brandId,
      changeSetId: set.id,
      kind: "set_status",
      level: alert.level,
      entityId: alert.entityId,
      entityName: alert.entityName,
      state: "pending",
      source: "rule",
      alertId: alert.id,
      reason: alert.message,
      payload: {
        resource: alert.level,
        fields: { status: "PAUSED" },
        // Staleness: if somebody has moved it since, the executor leaves it.
        expected: { status },
        expectedStatus: status,
      },
    });
  }

  return { proposed: rows.length, skipped, setId: set.id };
}

/** Mean daily spend over the trailing week, for the guardrail denominator. */
async function trailingDailySpend(brandId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${metricsDaily.spend}), 0)` })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brandId),
        eq(metricsDaily.platform, "meta"),
        gte(
          metricsDaily.date,
          sql`to_char(now() - interval '7 days', 'YYYY-MM-DD')`,
        ),
      ),
    );
  return Number(row?.total ?? 0) / 7;
}
