import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import {
  CREATIVE_DASHBOARDS,
  EVAL_METRICS,
  runMetaCreativeDashboard,
  type CreativeDashboardType,
  type EvalMetric,
} from "@/lib/integrations/meta/creative-dashboards";

export const maxDuration = 300;

const VALID_DASH = new Set<CreativeDashboardType>(
  CREATIVE_DASHBOARDS.map((d) => d.id),
);
const VALID_METRIC = new Set<EvalMetric>(EVAL_METRICS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    await apiUser();
    const body = (await req.json()) as {
      connectionId?: string;
      dashboard?: string;
      startDate?: string;
      endDate?: string;
      metric?: string;
      threshold?: number;
      minSpend?: number;
    };

    const connectionId = String(body.connectionId ?? "");
    const dashboard = String(body.dashboard ?? "") as CreativeDashboardType;
    const metric = String(body.metric ?? "") as EvalMetric;
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const threshold = Number(body.threshold);
    const minSpend =
      body.minSpend !== undefined ? Math.max(0, Number(body.minSpend)) : 0;

    if (
      !connectionId ||
      !VALID_DASH.has(dashboard) ||
      !VALID_METRIC.has(metric) ||
      !ISO_DATE.test(startDate) ||
      !ISO_DATE.test(endDate) ||
      !Number.isFinite(threshold)
    ) {
      return Response.json(
        { error: "Pick an account, dashboard, metric, threshold and date range." },
        { status: 400 },
      );
    }

    const conn = await db.query.integrationConnections.findFirst({
      where: eq(integrationConnections.id, connectionId),
    });
    if (!conn || conn.platform !== "meta") {
      return Response.json({ error: "Meta account not found." }, { status: 404 });
    }

    // 403/404 unless the user can access the brand this account belongs to.
    await apiBrand(conn.brandId);

    const data = await runMetaCreativeDashboard(conn, {
      dashboard,
      startDate,
      endDate,
      metric,
      threshold,
      minSpend,
    });
    return Response.json({ data });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("meta creative dashboard error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard" },
      { status: 500 },
    );
  }
}
