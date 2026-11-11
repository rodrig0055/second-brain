import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adAlerts, adRules } from "@/db/schema";
import { AdsNotConnected } from "@/components/ads/not-connected";
import { adsPath, requireAdsTeam } from "@/lib/ads/access";
import { resolveMetaScope } from "@/lib/ads/scope";
import { AdsToolbar } from "../toolbar";
import { AlertsTable, type AlertRow } from "@/components/ads/alerts-table";
import { RulesEditor, type EditableRule } from "@/components/ads/rules-editor";
import { RunRulesButton } from "./run-rules";
import type { RuleKind } from "@/lib/ads/rules/types";

/**
 * What the rules found, and what the rules are.
 *
 * Two halves of one thing: an alert is only as meaningful as the threshold that
 * raised it, and until this tab there was no way to see or change one.
 */
export default async function AdsAlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team } = await requireAdsTeam(teamSlug);
  const scope = await resolveMetaScope(user, sp);

  if (scope.all.length === 0) {
    return (
      <AdsNotConnected />
    );
  }

  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const tab = one("tab") === "rules" ? "rules" : "alerts";
  const severity = one("sev");
  const state = one("state") || "open";

  const connectionIds = scope.selected.map((s) => s.connection.id);
  const byConnection = new Map(scope.selected.map((s) => [s.connection.id, s]));

  const base = `${adsPath(team.slug)}/alerts`;
  const linkTo = (next: Record<string, string>) =>
    `${base}?${new URLSearchParams({ brands: scope.param, tab, state, ...next })}`;

  if (tab === "rules") {
    // Rules are per account, so this half asks which one.
    const account =
      scope.selected.find((s) => s.brand.id === one("brand")) ?? scope.selected[0];
    const rules = account
      ? await db
          .select()
          .from(adRules)
          .where(eq(adRules.connectionId, account.connection.id))
          .orderBy(adRules.key)
      : [];

    const model: EditableRule[] = rules.map((r) => ({
      id: r.id,
      key: r.key,
      kind: r.kind as RuleKind,
      label: r.label,
      enabled: r.enabled,
      level: r.level,
      funnels: (r.funnels ?? []) as string[],
      includeEventAdSets: r.includeEventAdSets,
      params: (r.params ?? {}) as Record<string, number>,
      currency: r.currency,
      source: r.source,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
    }));

    return (
      <>
        <AdsToolbar scope={scope.raw} pathname={base} query={{ tab: "rules" }} showDates={false} />
        <Tabs tab={tab} linkTo={linkTo} />

        {scope.selected.length > 1 && (
          <nav className="mb-3 flex flex-wrap gap-1.5">
            {scope.selected.map((s) => (
              <Link
                key={s.brand.id}
                href={linkTo({ brand: s.brand.id })}
                className={`rounded-md px-2.5 py-1.5 text-xs ${
                  s.brand.id === account?.brand.id
                    ? "bg-zinc-900 text-zinc-50"
                    : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {s.brand.name}
              </Link>
            ))}
          </nav>
        )}

        {account && (
          <RulesEditor
            rules={model}
            teamSlug={team.slug}
            brandId={account.brand.id}
            brandName={account.brand.name}
            currency={account.currency}
          />
        )}
      </>
    );
  }

  const states = state === "all" ? ["open", "acknowledged", "resolved"] : [state];
  const alerts = connectionIds.length
    ? await db
        .select()
        .from(adAlerts)
        .where(
          and(
            inArray(adAlerts.connectionId, connectionIds),
            inArray(adAlerts.state, states),
            severity ? eq(adAlerts.severity, severity) : undefined,
          ),
        )
        .orderBy(desc(adAlerts.severity), desc(adAlerts.lastSeenAt))
    : [];

  const rows: AlertRow[] = alerts.map((a) => {
    const account = byConnection.get(a.connectionId);
    return {
      id: a.id,
      brandId: a.brandId,
      brandName: account?.brand.name ?? "",
      brandSlug: account?.brand.slug ?? "",
      adAccountId: account?.adAccountId ?? "",
      writeOk: account?.writeGate.ok ?? false,
      severity: a.severity,
      level: a.level,
      entityId: a.entityId,
      entityName: a.entityName,
      funnel: a.funnel,
      ruleKey: a.ruleKey,
      message: a.message,
      metric: a.metric ?? "",
      observed: a.observed ?? "",
      threshold: a.threshold ?? "",
      provisional: a.provisional,
      confirmed: a.confirmed,
      state: a.state,
      firstSeen: a.firstSeenAt.toISOString().slice(0, 10),
      lastSeen: a.lastSeenAt.toISOString().slice(0, 10),
    };
  });

  return (
    <>
      <AdsToolbar scope={scope.raw} pathname={base} query={{ tab, state }} showDates={false} />
      <Tabs tab={tab} linkTo={linkTo} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          { key: "open", label: "Open" },
          { key: "acknowledged", label: "Seen" },
          { key: "resolved", label: "Resolved" },
          { key: "all", label: "All" },
        ].map((s) => (
          <Link
            key={s.key}
            href={linkTo({ state: s.key })}
            className={`rounded-md px-2.5 py-1.5 text-xs ${
              s.key === state
                ? "bg-zinc-900 text-zinc-50"
                : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {s.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-200" />
        {[
          { key: "", label: "Any severity" },
          { key: "critical", label: "Kill" },
          { key: "warning", label: "Watch" },
        ].map((s) => (
          <Link
            key={s.key || "any"}
            href={linkTo({ sev: s.key })}
            className={`rounded-md px-2.5 py-1.5 text-xs ${
              s.key === severity
                ? "bg-zinc-900 text-zinc-50"
                : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {s.label}
          </Link>
        ))}
        <div className="grow" />
        {scope.selected.map((s) => (
          <RunRulesButton
            key={s.brand.id}
            teamSlug={team.slug}
            brandId={s.brand.id}
            label={scope.selected.length > 1 ? `Run rules: ${s.brand.name}` : "Run rules now"}
          />
        ))}
      </div>

      <AlertsTable rows={rows} teamSlug={team.slug} multiBrand={scope.selected.length > 1} />
    </>
  );
}

function Tabs({
  tab,
  linkTo,
}: {
  tab: string;
  linkTo: (next: Record<string, string>) => string;
}) {
  return (
    <nav className="mb-3 flex gap-1.5">
      {[
        { key: "alerts", label: "Alerts" },
        { key: "rules", label: "Rules" },
      ].map((t) => (
        <Link
          key={t.key}
          href={linkTo({ tab: t.key })}
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
            t.key === tab
              ? "bg-zinc-900 text-zinc-50"
              : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
