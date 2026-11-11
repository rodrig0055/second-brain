import type { Blended } from "@/lib/insights/data";
import { deltaPct, formatMoney } from "@/lib/insights/data";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";

/**
 * Blended top-line. Money figures are shown in the chosen display currency;
 * when the brand mixes currencies (e.g. PHP commerce + USD ads) ROAS is gated
 * and a note names the excluded currencies, we never fake-convert.
 */
export function KpiHeader({ blended }: { blended: Blended }) {
  const {
    displayCurrency,
    otherCurrencies,
    revenue,
    prevRevenue,
    spend,
    prevSpend,
    roas,
    prevRoas,
    orders,
    prevOrders,
    commerceCurrency,
    aov,
    prevAov,
  } = blended;

  const cur = displayCurrency || commerceCurrency || "";
  const mixedNote =
    otherCurrencies.length > 0
      ? `Excludes ${otherCurrencies.join(", ")}, shown per platform below.`
      : undefined;

  const compareLabel = "vs previous period";
  return (
    <KpiGrid cols={5}>
      <KpiTile
        label="Revenue"
        value={cur ? formatMoney(revenue, cur) : "N/A"}
        delta={deltaPct(revenue, prevRevenue)}
        compareLabel={compareLabel}
        hint={mixedNote}
      />
      <KpiTile
        label="Ad spend"
        value={cur ? formatMoney(spend, cur) : "N/A"}
        delta={deltaPct(spend, prevSpend)}
        compareLabel={compareLabel}
        invert
      />
      <KpiTile
        label="ROAS / MER"
        value={roas !== null ? `${roas.toFixed(2)}×` : "N/A"}
        delta={roas !== null && prevRoas !== null ? deltaPct(roas, prevRoas) : null}
        compareLabel={compareLabel}
        hint={roas === null ? "Mixed currencies" : undefined}
      />
      <KpiTile
        label="Orders"
        value={orders.toLocaleString("en-PH")}
        delta={deltaPct(orders, prevOrders)}
        compareLabel={compareLabel}
      />
      <KpiTile
        label="Avg order value"
        value={aov !== null && commerceCurrency ? formatMoney(aov, commerceCurrency) : "N/A"}
        delta={aov !== null && prevAov !== null ? deltaPct(aov, prevAov) : null}
        compareLabel={compareLabel}
      />
    </KpiGrid>
  );
}
