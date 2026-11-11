import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import { outputKind } from "@/lib/image-output";
import { decideImageSettings } from "@/lib/image-settings-decide";

export const maxDuration = 30;

/**
 * The studio's live "Auto" preview: what GPT Image 2.6 settings this brief
 * would run with. The studio sends the answer back with the run, so the brief
 * is read once, not once here and again at generation.
 */
export async function POST(req: Request) {
  try {
    const user = await apiUser();
    const body = (await req.json().catch(() => ({}))) as {
      brief?: unknown;
      hasReferences?: unknown;
      output?: unknown;
      brandId?: unknown;
    };
    const brief = String(body.brief ?? "").trim();
    const brandId = String(body.brandId ?? "");
    if (!brief || !brandId) {
      return Response.json({ error: "A brand and a brief are needed." }, { status: 400 });
    }
    await apiBrand(brandId);
    const settings = await decideImageSettings({
      brief,
      hasReferences: body.hasReferences === true,
      output: outputKind(String(body.output ?? "")),
      userId: user.id,
      brandId,
    });
    return Response.json(settings);
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("image settings error", err);
    return Response.json({ error: "Could not read the brief" }, { status: 500 });
  }
}
