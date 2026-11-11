import Link from "next/link";
import { getUserBrands, requireUser } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { insightPlatformsForBrand } from "@/lib/insights/platforms";
import { loadInsights, parseRange } from "@/lib/insights/data";
import { Suspense } from "react";
import { DateFilter } from "@/components/date-filter";
import { dateRangeParams } from "@/lib/date-range";
import { KpiHeader } from "@/components/insights/kpi-header";
import { RevenueSpendChart } from "@/components/insights/revenue-spend-chart";
import { PlatformSection } from "@/components/insights/platform-section";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const brands = await getUserBrands(user);
  const sp = await searchParams;
  const brandSlug = typeof sp.brand === "string" ? sp.brand : undefined;

  const brand = brands.find((b) => b.slug === brandSlug) ?? brands[0] ?? null;
  const range = parseRange(sp);
  const isAdmin = user.role === "admin";

  const data = brand ? await loadInsights(brand.id, range) : null;

  // Shopify is Northwind Audio only (every other brand runs a custom CMS). Keep the
  // section if the brand somehow already has Shopify data/connection.
  const shopifyData = data?.byPlatform.get("shopify");
  const platforms = brand
    ? insightPlatformsForBrand(
        brand.domain,
        Boolean(shopifyData?.hasData || shopifyData?.connection),
      )
    : [];

  const hasAnyData =
    data &&
    platforms.some((spec) => data.byPlatform.get(spec.id)?.hasData);

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Insights"
        description={
          brand ? `Performance for ${brand.name}` : undefined
        }
        action={
          <Suspense fallback={null}>
            <DateFilter range={range.resolved} presets={["7d", "30d", "90d"]} />
          </Suspense>
        }
      />

      {brands.length === 0 ? (
        <p className="text-sm text-zinc-500">
          You don&apos;t have access to any brands yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <Link
                key={b.id}
                href={`/insights?${new URLSearchParams({ brand: b.slug, ...dateRangeParams(range.resolved) })}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  brand?.id === b.id
                    ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                    : "border-zinc-200 text-zinc-700 hover:border-zinc-300"
                }`}
              >
                {b.name}
              </Link>
            ))}
          </div>

          {data && (
            <div className="mt-8 space-y-8">
              <KpiHeader blended={data.blended} />

              {hasAnyData ? (
                <section>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Revenue vs spend
                    </h2>
                    {data.blended.displayCurrency && (
                      <span className="text-[0.7rem] text-zinc-400">
                        {data.blended.displayCurrency}
                        {data.blended.otherCurrencies.length > 0 &&
                          " · other currencies shown per platform"}
                      </span>
                    )}
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
                    <RevenueSpendChart
                      data={data.dailyBlended}
                      currency={data.blended.displayCurrency || "USD"}
                    />
                  </div>
                </section>
              ) : (
                <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">
                  No data for {brand?.name} in this range. Connect a platform
                  under{" "}
                  <Link
                    href="/admin/integrations"
                    className="underline underline-offset-2 hover:text-zinc-700"
                  >
                    Admin → Integrations
                  </Link>
                  .
                </p>
              )}

              <section>
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  By platform
                </h2>
                <div className="space-y-2">
                  {platforms.map((spec) => (
                    <PlatformSection
                      key={spec.id}
                      spec={spec}
                      data={data.byPlatform.get(spec.id)}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
