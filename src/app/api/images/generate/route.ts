import { putObject } from "@/lib/storage";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brandAssets, imageGenerations, imageTemplates } from "@/db/schema";
import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import { buildImagePrompt } from "@/lib/image-prompt";
import {
  generateBrandImage,
  IMAGE_MODEL_OPTIONS,
  type ReferenceImage,
} from "@/lib/image-models";
import { parseOutputSpec, supportsOutput, usesReferences } from "@/lib/image-output";
import { parseSettings, takesSettings } from "@/lib/image-settings";
import { decideImageSettings } from "@/lib/image-settings-decide";
import { resolvePlatform } from "@/lib/platforms";
import { createSseStream, SSE_HEADERS } from "@/lib/sse";
import { logImageUsage } from "@/lib/usage";

export const maxDuration = 300;

const VALID_MODELS: Set<string> = new Set(IMAGE_MODEL_OPTIONS.map((m) => m.id));
const MAX_UPLOADS = 6;
const MAX_PLATFORMS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Longest edge we send to the image providers; keeps references well under
// OpenAI's edit-endpoint size limits without throwing away useful detail.
const MAX_REFERENCE_EDGE = 2048;

/**
 * Fetch a reference image and normalise it to a clean sRGB PNG.
 *
 * Brand assets and imported URLs can be any format an admin happened to upload
 * (SVG logos, WebP/AVIF/HEIC, CMYK JPEGs, animated GIFs…). The AI SDK only
 * sniffs PNG/JPEG/GIF/WebP magic bytes and otherwise mislabels the file as
 * `image/png`, so OpenAI's `/images/edits` endpoint rejects the request with
 * "Invalid image file or mode for image N". Rasterising/transcoding every
 * reference to PNG here (flattening colour mode, honouring EXIF orientation,
 * taking the first frame of animated formats) makes every reference reliably
 * acceptable to both OpenAI and Gemini.
 */
async function fetchReference(url: string): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const png = await sharp(input, { animated: false, failOn: "none", density: 200 })
      .rotate() // apply EXIF orientation before we strip metadata
      .resize({
        width: MAX_REFERENCE_EDGE,
        height: MAX_REFERENCE_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return { bytes: new Uint8Array(png), mediaType: "image/png" };
  } catch (err) {
    console.error("reference normalisation failed", url, err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const user = await apiUser();
    const form = await req.formData();

    const brandId = String(form.get("brandId") ?? "");
    const brief = String(form.get("brief") ?? "").trim();
    // Still image, animated GIF or vector SVG. GIF and SVG only exist on GPT
    // Image 2.6, so any other model picked alongside is dropped, not failed.
    const outputSpec = parseOutputSpec(
      form.get("output") as string | null,
      form.get("frames"),
      form.get("frameMs"),
    );
    const modelIds = form
      .getAll("modelIds")
      .map(String)
      .filter((m) => VALID_MODELS.has(m) && supportsOutput(m, outputSpec.kind));
    // Custom sizes mean the list is no longer bounded by the presets, so cap
    // the fan-out (it multiplies by models and variants).
    const platformIds = [...new Set(form.getAll("platforms").map(String))]
      .filter((p) => resolvePlatform(p) !== undefined)
      .slice(0, MAX_PLATFORMS);
    const assetIds = form.getAll("assetIds").map(String);
    const variants = Math.min(Math.max(Number(form.get("variants") ?? 1) || 1, 1), 4);

    if (!brandId || !brief || modelIds.length === 0 || platformIds.length === 0) {
      return Response.json(
        {
          error:
            outputSpec.kind === "image"
              ? "Pick a brand, a brief, at least one model and one platform."
              : `Pick a brand, a brief, a GPT Image 2.6 model and one platform: ${outputSpec.kind.toUpperCase()} output only runs on 2.6.`,
        },
        { status: 400 },
      );
    }

    // 404/403s if the user has no access to the selected brand.
    await apiBrand(brandId);

    // Reference images: uploaded files → Blob, plus selected brand assets.
    const referenceUrls: string[] = [];
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    for (const file of files.slice(0, MAX_UPLOADS)) {
      if (file.size === 0) continue;
      const blob = await putObject(
        `references/${crypto.randomUUID()}-${file.name}`,
        file,
      );
      referenceUrls.push(blob.url);
    }
    if (assetIds.length > 0) {
      const assets = await db.query.brandAssets.findMany({
        where: inArray(brandAssets.id, assetIds),
      });
      for (const a of assets) if (a.brandId === brandId) referenceUrls.push(a.url);
    }
    // Images imported from a product/collection URL (picked in the studio).
    for (const u of form.getAll("importedUrls").map(String)) {
      if (/^https?:\/\/\S+$/i.test(u)) referenceUrls.push(u);
    }

    // SVG is generation-only, so its references are recorded on the run but
    // not fetched. Stills and GIFs send them to the edit endpoint.
    const references =
      usesReferences(outputSpec.kind)
        ? (await Promise.all(referenceUrls.map(fetchReference))).filter(
            (r): r is ReferenceImage => r !== null,
          )
        : [];

    // Which template the run came from, so the library can rank templates by use. Checked against
    // the table because a template deleted mid-session would otherwise fail the insert on its FK.
    const templateIdRaw = String(form.get("templateId") ?? "");
    const template = UUID_RE.test(templateIdRaw)
      ? await db.query.imageTemplates.findFirst({
          where: eq(imageTemplates.id, templateIdRaw),
          columns: { id: true },
        })
      : undefined;

    const [gen] = await db
      .insert(imageGenerations)
      .values({
        userId: user.id,
        brandId,
        templateId: template?.id ?? null,
        models: modelIds,
        brief,
        platforms: platformIds,
        referenceUrls,
        status: "running",
      })
      .returning();

    // 2.6 planning and detail: the studio sends what it previewed (auto or the
    // person's override). Without it, read the brief here instead.
    const settings = modelIds.some(takesSettings)
      ? (parseSettings(form.get("settings")) ??
        (await decideImageSettings({
          brief,
          hasReferences: references.length > 0,
          output: outputSpec.kind,
          userId: user.id,
          brandId,
        })))
      : undefined;

    const importedContext = String(form.get("importedContext") ?? "").trim();
    const prompt = await buildImagePrompt(brandId, brief, importedContext || null);

    // Fan out across every model × platform × variant in parallel; isolate failures.
    const jobs = modelIds.flatMap((modelId) =>
      platformIds.flatMap((platformId) =>
        Array.from({ length: variants }, (_, v) => ({ modelId, platformId, variant: v + 1 })),
      ),
    );

    type ImgOutput = {
      model: string;
      platform: string;
      variant: number;
      url: string;
      settings?: { complexity: string; fineDetail: boolean; source: string };
    };
    type ImgError = { modelId: string; platformId: string; variant: number; message: string };

    // Stream each job's result (or error) to the client as it lands, rather than
    // waiting for the slowest. The client fills the grid incrementally.
    const { stream, send, close } = createSseStream();

    (async () => {
      send({ type: "start", id: gen.id });
      const outputs: ImgOutput[] = [];
      const errors: ImgError[] = [];

      await Promise.all(
        jobs.map(async ({ modelId, platformId, variant }) => {
          try {
            const platform = resolvePlatform(platformId)!;
            const img = await generateBrandImage({
              modelId,
              prompt,
              referenceImages: references,
              aspectRatio: platform.aspectRatio,
              size: platform.size,
              output: outputSpec,
              settings,
            });
            await logImageUsage({
              model: modelId,
              usage: img.usage,
              userId: user.id,
              brandId,
              refId: gen.id,
            });
            const ext = img.mediaType.includes("jpeg")
              ? "jpg"
              : img.mediaType === "image/gif"
                ? "gif"
                : img.mediaType === "image/svg+xml"
                  ? "svg"
                  : "png";
            const blob = await putObject(
              `generated/${gen.id}/${modelId.replace("/", "_")}-${platformId}-v${variant}.${ext}`,
              Buffer.from(img.bytes),
              { contentType: img.mediaType },
            );
            const output: ImgOutput = {
              model: modelId,
              platform: platformId,
              variant,
              url: blob.url,
              ...(settings && takesSettings(modelId)
                ? {
                    settings: {
                      complexity: settings.complexity,
                      fineDetail: settings.fineDetail,
                      source: settings.source,
                    },
                  }
                : {}),
            };
            outputs.push(output);
            send({ type: "image", ...output });
          } catch (e) {
            const error: ImgError = {
              modelId,
              platformId,
              variant,
              message: String((e as Error)?.message ?? e),
            };
            errors.push(error);
            send({ type: "error", ...error });
          }
        }),
      );

      if (errors.length > 0) console.error("image generation per-model errors", errors);
      await db
        .update(imageGenerations)
        .set({ outputs, status: outputs.length > 0 ? "done" : "error" })
        .where(eq(imageGenerations.id, gen.id));
      send({ type: "done", id: gen.id, count: outputs.length });
      close();
    })();

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("image generate error", err);
    return Response.json({ error: "Image generation failed" }, { status: 500 });
  }
}
