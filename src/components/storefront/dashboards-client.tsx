"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { KpiTile } from "@/components/kpi-tile";
import { LoadingRegion, SkeletonKpis, SkeletonTable } from "@/components/skeleton";

export type StorefrontBrand = { id: string; name: string; domain: string };

type Snapshot = {
  id: string;
  source: "sitemap" | "feed";
  countryCode: string;
  status: string;
  totalItems: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  summary: Record<string, number>;
  errorMessage: string | null;
  capturedAt: string;
};
type FeedChange = {
  productId: string;
  title: string;
  changeKind: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
};
type SitemapChange = {
  url: string;
  urlType: string;
  changeKind: string;
  detectedAt: string;
};
type HistoryData = {
  brand: StorefrontBrand;
  snapshots: Snapshot[];
  feedChanges: FeedChange[];
  sitemapChanges: SitemapChange[];
};
type LiveProduct = {
  id: string;
  title: string;
  link: string;
  price: string;
  salePrice: string;
  availability: string;
  productType: string;
};
type LiveData = {
  brand: { name: string; domain: string };
  sitemap: { ok: boolean; url: string; total: number; byType: Record<string, number> };
  feed: {
    ok: boolean;
    url: string;
    total: number;
    inStock: number;
    outOfStock: number;
    onSale: number;
    sample: LiveProduct[];
  };
  fetchedAt: string;
};

const RANGES = [
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
];

const num = new Intl.NumberFormat("en-US");
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-700">{children}</h3>;
}
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[26rem] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-card">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium text-zinc-500 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
function Td({
  children,
  right,
  tone,
}: {
  children: React.ReactNode;
  right?: boolean;
  tone?: "good" | "bad" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-500"
        : tone === "muted"
          ? "text-zinc-400"
          : "text-zinc-800";
  return <td className={`px-3 py-2 ${right ? "text-right tabular-nums" : ""} ${color}`}>{children}</td>;
}
function kindTone(kind: string): "good" | "bad" | "muted" {
  if (kind === "added") return "good";
  if (kind === "removed") return "bad";
  return "muted";
}

export function StorefrontDashboards({ brands }: { brands: StorefrontBrand[] }) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [mode, setMode] = useState<"history" | "current">("history");
  const [days, setDays] = useState(30);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const loadHistory = useCallback(async () => {
    if (!brandId) return;
    const token = ++reqRef.current;
    setLoading(true);
    setError(null);
    setHistory(null);
    try {
      const res = await fetch("/api/storefront/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, days }),
      });
      const json = await res.json();
      if (token !== reqRef.current) return;
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setHistory(json.data as HistoryData);
    } catch (err) {
      if (token !== reqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, [brandId, days]);

  const loadLive = useCallback(async () => {
    if (!brandId) return;
    const token = ++reqRef.current;
    setLoading(true);
    setError(null);
    setLive(null);
    try {
      const res = await fetch("/api/storefront/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      const json = await res.json();
      if (token !== reqRef.current) return;
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setLive(json.data as LiveData);
    } catch (err) {
      if (token !== reqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, [brandId]);

  // History loads automatically; live fetch is on demand (it's slow — it hits
  // the live sites).
  useEffect(() => {
    if (mode === "history") queueMicrotask(() => void loadHistory());
  }, [mode, loadHistory]);

  const latest = (source: "sitemap" | "feed") =>
    history?.snapshots.find((s) => s.source === source);

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="u-transition rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 shadow-card hover:border-zinc-300"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.domain}
            </option>
          ))}
        </select>

        <SegmentedControl
          label="View"
          value={mode}
          onChange={(v) => setMode(v as "history" | "current")}
        >
          <SegmentedControlItem value="history" label="History" />
          <SegmentedControlItem value="current" label="Current (live)" />
        </SegmentedControl>

        {mode === "history" && (
          <SegmentedControl
            label="Date range"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
          >
            {RANGES.map((r) => (
              <SegmentedControlItem key={r.days} value={String(r.days)} label={r.label} />
            ))}
          </SegmentedControl>
        )}

        {mode === "current" && (
          <Button
            label={loading ? "Fetching…" : live ? "Refresh" : "Fetch live"}
            variant="primary"
            isDisabled={loading}
            onClick={() => void loadLive()}
          />
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}
      {loading && !error && (
        <LoadingRegion label="Loading the storefront numbers">
          <SkeletonKpis count={4} />
          <SkeletonTable rows={6} />
        </LoadingRegion>
      )}

      {/* HISTORY */}
      {mode === "history" && history && !loading && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile
              label="Feed products"
              value={latest("feed") ? num.format(latest("feed")!.totalItems) : "—"}
              hint={
                latest("feed")
                  ? `${num.format(latest("feed")!.summary.inStock ?? 0)} in stock · ${num.format(latest("feed")!.summary.onSale ?? 0)} on sale`
                  : "no snapshot yet"
              }
            />
            <KpiTile
              label="Sitemap URLs"
              value={latest("sitemap") ? num.format(latest("sitemap")!.totalItems) : "—"}
              hint={
                latest("sitemap")
                  ? `${num.format(latest("sitemap")!.summary.product ?? 0)} products · ${num.format(latest("sitemap")!.summary.blog ?? 0)} blog`
                  : "no snapshot yet"
              }
            />
            <KpiTile
              label={`Feed changes · ${days}d`}
              value={num.format(history.feedChanges.length)}
              hint="price / stock / add / remove"
            />
            <KpiTile
              label={`Sitemap changes · ${days}d`}
              value={num.format(history.sitemapChanges.length)}
              hint="URLs added / removed"
            />
          </div>

          <SectionTitle>Snapshots</SectionTitle>
          {history.snapshots.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No snapshots captured yet. The weekly job runs Mondays, or an admin can capture now.
            </p>
          ) : (
            <TableShell>
              <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide">
                <tr>
                  <Th>Captured</Th>
                  <Th>Source</Th>
                  <Th right>Total</Th>
                  <Th right>Added</Th>
                  <Th right>Removed</Th>
                  <Th right>Changed</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {history.snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100">
                    <Td>{when(s.capturedAt)}</Td>
                    <Td>{s.source}</Td>
                    <Td right>{num.format(s.totalItems)}</Td>
                    <Td right tone={s.addedCount ? "good" : "muted"}>{num.format(s.addedCount)}</Td>
                    <Td right tone={s.removedCount ? "bad" : "muted"}>{num.format(s.removedCount)}</Td>
                    <Td right tone={s.changedCount ? undefined : "muted"}>{num.format(s.changedCount)}</Td>
                    <Td tone={s.status === "error" ? "bad" : s.status === "done" ? "good" : "muted"}>
                      {s.status === "error" ? s.errorMessage || "error" : s.status}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}

          <SectionTitle>Recent feed changes</SectionTitle>
          {history.feedChanges.length === 0 ? (
            <p className="text-sm text-zinc-500">No feed changes in this window.</p>
          ) : (
            <TableShell>
              <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide">
                <tr>
                  <Th>When</Th>
                  <Th>Product</Th>
                  <Th>Change</Th>
                  <Th>Field</Th>
                  <Th>From → To</Th>
                </tr>
              </thead>
              <tbody>
                {history.feedChanges.map((c, i) => (
                  <tr key={`${c.productId}-${i}`} className="border-t border-zinc-100">
                    <Td>{when(c.detectedAt)}</Td>
                    <Td>{c.title || c.productId}</Td>
                    <Td tone={kindTone(c.changeKind)}>{c.changeKind}</Td>
                    <Td tone="muted">{c.field ?? "—"}</Td>
                    <Td>
                      {c.changeKind === "updated"
                        ? `${c.oldValue ?? "∅"} → ${c.newValue ?? "∅"}`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}

          <SectionTitle>Recent sitemap changes</SectionTitle>
          {history.sitemapChanges.length === 0 ? (
            <p className="text-sm text-zinc-500">No sitemap changes in this window.</p>
          ) : (
            <TableShell>
              <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide">
                <tr>
                  <Th>When</Th>
                  <Th>URL</Th>
                  <Th>Type</Th>
                  <Th>Change</Th>
                </tr>
              </thead>
              <tbody>
                {history.sitemapChanges.map((c, i) => (
                  <tr key={`${c.url}-${i}`} className="border-t border-zinc-100">
                    <Td>{when(c.detectedAt)}</Td>
                    <Td>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
                      >
                        {c.url.replace(/^https?:\/\/[^/]+/, "")}
                      </a>
                    </Td>
                    <Td tone="muted">{c.urlType}</Td>
                    <Td tone={kindTone(c.changeKind)}>{c.changeKind}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </div>
      )}

      {/* CURRENT (LIVE) */}
      {mode === "current" && live && !loading && (
        <div>
          <p className="mb-3 text-xs text-zinc-400">
            Fetched live {when(live.fetchedAt)} from {live.brand.domain}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile
              label="Sitemap URLs"
              value={live.sitemap.ok ? num.format(live.sitemap.total) : "fetch failed"}
              hint={
                live.sitemap.ok
                  ? `${num.format(live.sitemap.byType.product ?? 0)} products · ${num.format(live.sitemap.byType.blog ?? 0)} blog`
                  : undefined
              }
            />
            <KpiTile
              label="Feed products"
              value={live.feed.ok ? num.format(live.feed.total) : "fetch failed"}
            />
            <KpiTile
              label="In stock"
              value={live.feed.ok ? num.format(live.feed.inStock) : "—"}
              hint={live.feed.ok ? `${num.format(live.feed.outOfStock)} out of stock` : undefined}
            />
            <KpiTile
              label="On sale"
              value={live.feed.ok ? num.format(live.feed.onSale) : "—"}
            />
          </div>

          <SectionTitle>Products (first 50)</SectionTitle>
          <TableShell>
            <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide">
              <tr>
                <Th>Title</Th>
                <Th>Price</Th>
                <Th>Sale</Th>
                <Th>Availability</Th>
              </tr>
            </thead>
            <tbody>
              {live.feed.sample.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <Td>
                    <a
                      href={p.link}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
                    >
                      {p.title || p.id}
                    </a>
                  </Td>
                  <Td>{p.price}</Td>
                  <Td tone={p.salePrice ? "good" : "muted"}>{p.salePrice || "—"}</Td>
                  <Td tone={p.availability.toLowerCase() === "in stock" ? "good" : "bad"}>
                    {p.availability}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}

      {mode === "current" && !live && !loading && !error && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-card">
          Click <span className="font-medium text-zinc-700">Fetch live</span> to pull the latest
          sitemap and product feed directly from {brands.find((b) => b.id === brandId)?.domain}.
          This takes a few seconds.
        </div>
      )}
    </div>
  );
}
