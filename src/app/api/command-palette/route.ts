import { accessErrorResponse, apiUser } from "@/lib/access";
import { paletteHits } from "@/lib/command-palette";

/** Records for the Cmd+K palette. Access-scoped in `paletteHits`; never cached across people. */
export async function GET(req: Request) {
  try {
    const user = await apiUser();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const hits = await paletteHits(user, q);
    return Response.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
