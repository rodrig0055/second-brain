/**
 * Bearer check shared by every /api/cron/* route.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations
 * automatically when CRON_SECRET is set, so the same check covers both the
 * scheduled call and a manual curl.
 *
 * These routes are exempt from the auth middleware (see the `api/cron` entry in
 * the matcher in src/proxy.ts), so this is the only thing standing in front of
 * them. It fails closed: no secret configured means no access, rather than an
 * open endpoint.
 */
export function requireCronSecret(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
