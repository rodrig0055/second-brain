import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type { DbConnection } from "../types";

// GA4 Data API. Auth reuses the same service account as the GSC/BigQuery export
// (GCP_SERVICE_ACCOUNT_JSON) — the service account must be granted at least
// "Viewer" on each GA4 property we read. There are no per-brand secrets: a
// connection stores only the numeric property id, so `encryptedCredentials` is
// null for GA4 and all report calls go out as the shared service account.

let client: BetaAnalyticsDataClient | null = null;

function loadCredentials(): Record<string, unknown> {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not set — GA4 tools are unavailable.");
  }
  const json = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not valid JSON (raw or base64).");
  }
}

async function getAnalyticsClient(): Promise<BetaAnalyticsDataClient> {
  if (!client) {
    // A laptop running a sync script has no service account, but usually has
    // `gcloud auth application-default login`. Opt in with GCP_USE_ADC=1 so a
    // deployment missing its secret still fails loudly instead of guessing.
    if (!process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_USE_ADC === "1") {
      const adc = new BetaAnalyticsDataClient();
      // Resolve the login before the first request. Left to the first request,
      // a missing login also rejects one promise per API method inside
      // google-gax that nothing awaits, and Node exits even though the caller
      // caught the error. Failing here is an ordinary rejection.
      await adc.auth.getClient();
      client = adc;
      return client;
    }
    const credentials = loadCredentials();
    client = new BetaAnalyticsDataClient({
      credentials,
      projectId: (credentials.project_id as string | undefined) || undefined,
    });
  }
  return client;
}

/** Strip everything but digits from a property id (319768360, not properties/…). */
export function normalizePropertyId(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

/** Resolve the `properties/<id>` resource name for a connection. */
export function resolveGa4Property(conn: DbConnection): string {
  const id = normalizePropertyId(
    String(conn.config.propertyId ?? conn.externalAccountId ?? ""),
  );
  if (!id) throw new Error("GA4 connection is missing its property id.");
  return `properties/${id}`;
}

export type Ga4ReportRequest = {
  property: string; // "properties/<id>"
  startDate: string; // YYYY-MM-DD or GA4 relative (e.g. "28daysAgo")
  endDate: string;
  dimensions?: string[];
  metrics: string[];
  orderByMetric?: string; // metric name to sort by, descending
  limit?: number;
  /** Row offset, for paging through a report bigger than one response. */
  offset?: number;
};

export type Ga4Report = {
  rows: Record<string, string>[]; // header name -> value
  currency: string;
  timezone: string;
  rowCount: number;
};

/**
 * Run a GA4 Data API report and flatten it to rows keyed by dimension/metric
 * name. Metric values arrive as strings (GA4's format); callers coerce with
 * Number() as needed.
 */
export async function runGa4Report(req: Ga4ReportRequest): Promise<Ga4Report> {
  const analytics = await getAnalyticsClient();
  const [resp] = await analytics.runReport({
    property: req.property,
    dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
    dimensions: req.dimensions?.map((name) => ({ name })),
    metrics: req.metrics.map((name) => ({ name })),
    orderBys: req.orderByMetric
      ? [{ metric: { metricName: req.orderByMetric }, desc: true }]
      : undefined,
    limit: req.limit,
    offset: req.offset,
  });

  const dimHeaders = (resp.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const metHeaders = (resp.metricHeaders ?? []).map((h) => h.name ?? "");
  const rows = (resp.rows ?? []).map((r) => {
    const out: Record<string, string> = {};
    (r.dimensionValues ?? []).forEach((v, i) => {
      out[dimHeaders[i]] = v.value ?? "";
    });
    (r.metricValues ?? []).forEach((v, i) => {
      out[metHeaders[i]] = v.value ?? "";
    });
    return out;
  });

  return {
    rows,
    currency: resp.metadata?.currencyCode ?? "",
    timezone: resp.metadata?.timeZone ?? "",
    rowCount: resp.rowCount ?? rows.length,
  };
}

/**
 * Verify a property is readable by the service account by running a tiny report.
 * Returns currency + timezone from the report metadata (used to label the
 * connection). Throws with the API error if access is missing.
 */
export async function verifyGa4Credentials(
  propertyId: string,
): Promise<{ name: string; currency: string; timezone: string }> {
  const id = normalizePropertyId(propertyId);
  if (!id) throw new Error("A numeric GA4 property id is required.");
  const report = await runGa4Report({
    property: `properties/${id}`,
    startDate: "7daysAgo",
    endDate: "yesterday",
    metrics: ["sessions"],
    limit: 1,
  });
  return {
    name: `GA4 property ${id}`,
    currency: report.currency || "USD",
    timezone: report.timezone || "UTC",
  };
}
