import { apiUser } from "@/lib/access";
import {
  getStorefrontBrands,
  snapshotAllStorefronts,
  snapshotBrand,
} from "@/lib/storefront/snapshot";

export const maxDuration = 300;

// Trigger a storefront history snapshot on demand. Authorized by the cron
// secret (so it can be curled to seed/backfill) OR an admin session (dashboard
// "capture now" button). Optional body { brandSlug } snapshots one brand.
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return null;
  try {
    const user = await apiUser();
    if (user.role !== "admin") {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }
    return null;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  let brandSlug: string | undefined;
  try {
    const body = await req.json();
    brandSlug = typeof body?.brandSlug === "string" ? body.brandSlug : undefined;
  } catch {
    // no body / not JSON → snapshot all
  }

  try {
    if (brandSlug) {
      const brand = (await getStorefrontBrands()).find(
        (b) => b.slug === brandSlug,
      );
      if (!brand) {
        return Response.json(
          { error: `Not a storefront brand: ${brandSlug}` },
          { status: 404 },
        );
      }
      const results = await snapshotBrand(brand);
      return Response.json({ results });
    }
    return Response.json(await snapshotAllStorefronts());
  } catch (err) {
    console.error("storefront snapshot route error", err);
    return Response.json({ error: "Snapshot failed" }, { status: 500 });
  }
}
