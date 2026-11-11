"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import {
  DASHBOARDS,
  type DashboardResult,
  type DashboardType,
} from "@/lib/integrations/google_ads/dashboards";
import {
  AccountHealthView,
  AnomalyView,
  AuctionView,
  BudgetView,
  PmaxView,
  QualityScoreView,
  SearchWasteView,
} from "./charts";

type Account = {
  id: string;
  label: string;
  brand: string;
  customerId: string;
  currency: string;
  status: string;
};

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export function GoogleAdsDashboards({ accounts }: { accounts: Account[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [days, setDays] = useState(30);
  const [dashboard, setDashboard] = useState<DashboardType>("account_health");
  const [data, setData] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    const token = ++reqRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/google-ads/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: accountId, dashboard, days }),
      });
      const json = await res.json();
      if (token !== reqRef.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setData(json.data as DashboardResult);
    } catch (err) {
      if (token !== reqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, [accountId, dashboard, days]);

  // Reload whenever account / dashboard / range changes. Deferred to a microtask
  // so the fetch's state updates land after commit rather than synchronously.
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const active = DASHBOARDS.find((d) => d.id === dashboard);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Account
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="u-transition min-w-56 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.brand ? `, ${a.brand}` : ""}
                {a.customerId ? ` (${a.customerId})` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs text-zinc-600">
          Date range
          <SegmentedControl
            label="Date range"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
          >
            {RANGES.map((r) => (
              <SegmentedControlItem key={r.days} value={String(r.days)} label={r.label} />
            ))}
          </SegmentedControl>
        </div>
      </div>

      {/* Dashboard tabs */}
      <div className="mt-5 flex flex-wrap gap-2 border-b border-zinc-200 pb-3">
        {DASHBOARDS.map((d) => (
          <Button
            key={d.id}
            label={d.label}
            tooltip={d.blurb}
            variant={dashboard === d.id ? "primary" : "secondary"}
            onClick={() => setDashboard(d.id)}
          />
        ))}
      </div>

      {active && <p className="mt-3 text-xs text-zinc-500">{active.blurb}</p>}

      {/* Body */}
      <div className="mt-4 min-h-64">
        {loading && (
          <div className="flex items-center gap-2 py-16 text-sm">
            <span className="u-shimmer font-medium">Querying Google Ads…</span>
          </div>
        )}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error}
            <Button label="Retry" size="sm" onClick={() => void load()} className="ml-3" />
          </div>
        )}
        {!loading && !error && data && <DashboardBody data={data} />}
      </div>
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardResult }) {
  switch (data.type) {
    case "account_health":
      return <AccountHealthView d={data} />;
    case "pmax":
      return <PmaxView d={data} />;
    case "quality_score":
      return <QualityScoreView d={data} />;
    case "search_waste":
      return <SearchWasteView d={data} />;
    case "budget":
      return <BudgetView d={data} />;
    case "auction":
      return <AuctionView d={data} />;
    case "anomaly":
      return <AnomalyView d={data} />;
  }
}
