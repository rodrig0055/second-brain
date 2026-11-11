import { BigQuery } from "@google-cloud/bigquery";

/**
 * Lazy singleton BigQuery client built from a service-account JSON in the
 * environment. The same service account is the one linked to the GSC bulk
 * export. We accept the JSON either raw or base64-encoded (Vercel env values
 * are single-line, so base64 is the safest to paste).
 */
let client: BigQuery | null = null;

function loadCredentials(): { credentials: Record<string, unknown>; projectId: string } {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not set — BigQuery tools are unavailable.");
  }
  const json = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not valid JSON (raw or base64).");
  }
  const projectId =
    process.env.GCP_PROJECT_ID || (credentials.project_id as string | undefined) || "";
  if (!projectId) {
    throw new Error("GCP_PROJECT_ID is not set and the service account JSON has no project_id.");
  }
  return { credentials, projectId };
}

export function getBigQuery(): BigQuery {
  if (!client) {
    // Laptop scripts: `gcloud auth application-default login` instead of the
    // service account, opted into explicitly (see ga4/client.ts).
    if (!process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_USE_ADC === "1") {
      client = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });
      return client;
    }
    const { credentials, projectId } = loadCredentials();
    client = new BigQuery({ projectId, credentials });
  }
  return client;
}

export type GscRow = Record<string, string | number | null>;

/**
 * Runs a parameterized query against a GSC-export dataset and returns plain
 * rows. The SQL must already reference the dataset (callers build it via the
 * `dataset` value). Results are capped by `maxResults` as a safety net on top
 * of any LIMIT in the SQL.
 */
export async function runGscQuery(
  sql: string,
  params: Record<string, unknown>,
  maxResults = 1000,
): Promise<GscRow[]> {
  const bq = getBigQuery();
  const [rows] = await bq.query({ query: sql, params, maxResults });
  // BigQuery returns DATE/numeric wrappers; coerce to JSON-friendly primitives.
  return (rows as Record<string, unknown>[]).map((r) => {
    const out: GscRow = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) out[k] = null;
      else if (typeof v === "object" && "value" in (v as object))
        out[k] = (v as { value: string }).value;
      else if (typeof v === "number" || typeof v === "string") out[k] = v;
      else out[k] = String(v);
    }
    return out;
  });
}
