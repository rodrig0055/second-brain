import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import {
  DASHBOARDS,
  runDashboard,
  type DashboardType,
} from "@/lib/integrations/google_ads/dashboards";

export const maxDuration = 300;

const VALID = new Set<DashboardType>(DASHBOARDS.map((d) => d.id));
const ALLOWED_DAYS = new Set([7, 30, 90]);

export async function POST(req: Request) {
  try {
    await apiUser();
    const body = (await req.json()) as {
      connectionId?: string;
      dashboard?: string;
      days?: number;
    };

    const connectionId = String(body.connectionId ?? "");
    const dashboard = String(body.dashboard ?? "") as DashboardType;
    const days = ALLOWED_DAYS.has(Number(body.days)) ? Number(body.days) : 30;

    if (!connectionId || !VALID.has(dashboard)) {
      return Response.json({ error: "Pick an account and a valid dashboard." }, { status: 400 });
    }

    const conn = await db.query.integrationConnections.findFirst({
      where: eq(integrationConnections.id, connectionId),
    });
    if (!conn || conn.platform !== "google_ads") {
      return Response.json({ error: "Google Ads account not found." }, { status: 404 });
    }

    // 403/404 unless the user can access the brand this account belongs to.
    await apiBrand(conn.brandId);

    const data = await runDashboard(conn, dashboard, days);
    return Response.json({ data });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("google-ads dashboard error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard" },
      { status: 500 },
    );
  }
}
