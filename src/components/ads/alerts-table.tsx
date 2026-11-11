"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { brandTone } from "@/lib/brand-tone";
import {
  acknowledgeAlert,
  reopenAlert,
  setAdStatusNow,
  type AdsFormState,
} from "@/app/(app)/t/[team]/ads/actions";

/**
 * Every open alert, across the accounts in scope.
 *
 * Uncapped, deliberately. The old panel showed fifteen and said "N more" with
 * nowhere to go, which on a bad week hid exactly the alerts worth seeing.
 */

export type AlertRow = {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  adAccountId: string;
  writeOk: boolean;
  severity: string;
  level: string;
  entityId: string;
  entityName: string;
  funnel: string | null;
  ruleKey: string;
  message: string;
  metric: string;
  observed: string;
  threshold: string;
  provisional: boolean;
  confirmed: boolean;
  state: string;
  firstSeen: string;
  lastSeen: string;
};

const EMPTY: AdsFormState = {};

export function AlertsTable({
  rows,
  teamSlug,
  multiBrand,
}: {
  rows: AlertRow[];
  teamSlug: string;
  multiBrand: boolean;
}) {
  const columns: DataTableColumn<AlertRow>[] = [
    {
      key: "severity",
      label: "",
      value: (r) => (r.severity === "critical" ? 2 : 1),
      align: "left",
      lockVisible: true,
      width: 64,
      render: (r) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
            r.severity === "critical"
              ? "bg-red-50 text-red-600"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {r.severity === "critical" ? "kill" : "watch"}
        </span>
      ),
    },
    ...(multiBrand
      ? ([
          {
            key: "brand",
            label: "Account",
            value: (r) => r.brandName,
            align: "left" as const,
            render: (r) => (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={`size-1.5 rounded-full ${brandTone(r.brandSlug).dot}`} />
                {r.brandName}
              </span>
            ),
          },
        ] as DataTableColumn<AlertRow>[])
      : []),
    {
      key: "entity",
      label: "Ad",
      value: (r) => r.entityName,
      align: "left",
      searchable: true,
      render: (r) => (
        <Link
          href={`/t/${teamSlug}/ads/performance?${new URLSearchParams({
            brands: r.brandSlug,
            level: r.level === "adset" ? "adset" : "ad",
          })}`}
          className="block max-w-xs truncate hover:underline"
          title={r.entityName}
        >
          {r.entityName || r.entityId}
        </Link>
      ),
    },
    { key: "funnel", label: "Funnel", value: (r) => r.funnel ?? "unmapped", align: "left" },
    {
      key: "message",
      wide: true,
      label: "What happened",
      value: (r) => r.message,
      align: "left",
      searchable: true,
      render: (r) => (
        <span className="block max-w-md">
          {r.message}
          {r.provisional && (
            <span className="ml-1 text-[0.65rem] text-zinc-400" title="The window is not settled yet">
              provisional
            </span>
          )}
          {!r.confirmed && (
            <span
              className="ml-1 text-[0.65rem] text-amber-600"
              title="Judged against a threshold borrowed from another brand"
            >
              borrowed threshold
            </span>
          )}
        </span>
      ),
    },
    { key: "rule", label: "Rule", value: (r) => r.ruleKey, align: "left", defaultVisible: false },
    { key: "observed", label: "Observed", value: (r) => r.observed, align: "left" },
    { key: "threshold", label: "Threshold", value: (r) => r.threshold, align: "left" },
    { key: "lastSeen", label: "Last seen", value: (r) => r.lastSeen, align: "left" },
    { key: "state", label: "State", value: (r) => r.state, align: "left", defaultVisible: false },
    {
      key: "act",
      label: "",
      value: () => "",
      align: "left",
      sortable: false,
      searchable: false,
      render: (r) => <AlertActions row={r} teamSlug={teamSlug} />,
    },
  ];

  return (
    <DataTable
      id="ads-alerts"
      label="Alerts"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      defaultSort={{ key: "severity", dir: "desc" }}
      search={{ placeholder: "Search ads or messages" }}
      csv={{ filename: "meta-alerts" }}
      emptyLabel="Nothing is flagged right now."
      footnote="A borrowed threshold is one nobody has confirmed for this account yet. The Rules tab is where that changes."
    />
  );
}

function AlertActions({ row, teamSlug }: { row: AlertRow; teamSlug: string }) {
  const [ackState, ack, acking] = useActionState(acknowledgeAlert, EMPTY);
  const [reopenState, reopen, reopening] = useActionState(reopenAlert, EMPTY);
  const [pauseState, pause, pausing] = useActionState(setAdStatusNow, EMPTY);

  const hidden = (
    <>
      <input type="hidden" name="team" value={teamSlug} />
      <input type="hidden" name="brandId" value={row.brandId} />
      <input type="hidden" name="alertId" value={row.id} />
    </>
  );
  const error = ackState.error ?? reopenState.error ?? pauseState.error;

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {row.state === "open" ? (
        <form action={ack}>
          {hidden}
          <Button type="submit" label="Seen" size="sm" isDisabled={acking} />
        </form>
      ) : (
        <form action={reopen}>
          {hidden}
          <Button type="submit" label="Reopen" size="sm" isDisabled={reopening} />
        </form>
      )}

      {row.level === "ad" &&
        (row.writeOk ? (
          <form action={pause}>
            {hidden}
            <input type="hidden" name="entityId" value={row.entityId} />
            <input type="hidden" name="entityName" value={row.entityName} />
            <input type="hidden" name="kind" value="pause_ad" />
            <input type="hidden" name="currentStatus" value="ACTIVE" />
            <input type="hidden" name="reason" value={row.message} />
            <ConfirmSubmitButton
              message={`Pause "${row.entityName}" on Meta? It stops delivering immediately.`}
              isDisabled={pausing}
              label="Pause"
              tone="default"
              variant="primary"
            />
          </form>
        ) : (
          <Button
            href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${row.adAccountId.replace(/^act_/, "")}&selected_ad_ids=${row.entityId}`}
            target="_blank"
            rel="noreferrer"
            tooltip="Writes are off for this account"
            label="Manager"
            icon={<Icon icon={ExternalLink} />}
            size="sm"
          />
        ))}

      {error && <span className="text-[0.65rem] text-red-600">{error}</span>}
    </span>
  );
}
