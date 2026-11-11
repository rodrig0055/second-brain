"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { isImeEnter } from "@/lib/keyboard";
import { IMAGE_MODEL_OPTIONS, imageModelLabel } from "@/lib/image-model-options";
import { ImageModelSelect } from "@/components/image-model-select";
import { ImageDownloadLinks } from "@/components/image-download-links";
import {
  CUSTOM_MAX_EDGE,
  CUSTOM_MIN_EDGE,
  customPlatformId,
  customSizeError,
  PLATFORMS,
  platformLabel,
} from "@/lib/platforms";
import { readSse } from "@/lib/sse-client";
import {
  effectiveSettings,
  PlanningControl,
  useAutoImageSettings,
} from "@/components/image-planning";
import { planningCaption, takesSettings, type Complexity } from "@/lib/image-settings";
import {
  GIF_DEFAULT_FRAME_MS,
  GIF_DEFAULT_FRAMES,
  GIF_FRAME_OPTIONS,
  GIF_SPEED_OPTIONS,
  OUTPUT_KINDS,
  supportsOutput,
  type OutputKind,
} from "@/lib/image-output";

type Brand = { id: string; name: string };
type Asset = { id: string; brandId: string; url: string; label: string };
type Output = {
  model: string;
  platform: string;
  url: string;
  variant?: number;
  settings?: { complexity: string; fineDetail: boolean; source: string };
};

// Vercel rejects any function request body over 4.5 MB with a bare 413, before
// our route runs. Uploads travel in that body at full size, so budget them at
// 4 MB and leave headroom for the other form fields.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadTooLargeMessage(files: File[]) {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const biggest = [...files].sort((a, b) => b.size - a.size)[0];
  return (
    `Your uploaded images add up to ${formatMb(total)}, but one request can carry at most ` +
    `${formatMb(MAX_UPLOAD_BYTES)}. Remove an image, or upload smaller versions ` +
    `(a screenshot or a photo exported at around 2000px is plenty` +
    (biggest ? `; the largest is ${biggest.name} at ${formatMb(biggest.size)}` : "") +
    `).`
  );
}

// Turn a failed response into a sentence a user can act on. Our route answers
// with `{ error }` JSON; the platform (413, 504, …) answers with plain text.
async function failureMessage(res: Response, files: File[]) {
  const data = await res.json().catch(() => null);
  if (data?.error) return String(data.error);
  if (res.status === 413)
    return files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_BYTES
      ? uploadTooLargeMessage(files)
      : "The request was too large to send. Remove an uploaded image or two and try again.";
  if (res.status === 504)
    return "The generation took too long and timed out. Try fewer formats, versions or models at once.";
  if (res.status === 401 || res.status === 403)
    return "Your session has expired or you no longer have access. Refresh the page and sign in again.";
  if (res.status >= 500)
    return `The server hit an error (${res.status}). Try again in a moment; if it keeps happening, tell an admin.`;
  return `The request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""}).`;
}

export function ImageStudio({
  brands,
  assets,
  initialBrief,
  initialReferenceUrls,
  initialBrandId,
  templateId,
}: {
  brands: Brand[];
  assets: Asset[];
  initialBrief?: string;
  initialReferenceUrls?: string[];
  initialBrandId?: string;
  /** The template that prefilled this studio, recorded on each run so the library can rank by use. */
  templateId?: string;
}) {
  const [brandId, setBrandId] = useState(
    initialBrandId && brands.some((b) => b.id === initialBrandId)
      ? initialBrandId
      : (brands[0]?.id ?? ""),
  );
  const [models, setModels] = useState<string[]>([IMAGE_MODEL_OPTIONS[0].id]);
  const [platforms, setPlatforms] = useState<string[]>(["ig-post"]);
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [variants, setVariants] = useState(1);
  const [output, setOutput] = useState<OutputKind>("image");
  const [frames, setFrames] = useState<number>(GIF_DEFAULT_FRAMES);
  const [frameMs, setFrameMs] = useState<number>(GIF_DEFAULT_FRAME_MS);
  // GIF and SVG only run on GPT Image 2.6: switching to them keeps the 2.6
  // models already picked and falls back to the first 2.6 model otherwise.
  const chooseOutput = (kind: OutputKind) => {
    setOutput(kind);
    setModels((current) => {
      const kept = current.filter((m) => supportsOutput(m, kind));
      if (kept.length > 0) return kept;
      const first = IMAGE_MODEL_OPTIONS.find((m) => supportsOutput(m.id, kind));
      return first ? [first.id] : [];
    });
  };
  const unitWord = output === "gif" ? "GIF" : output === "svg" ? "SVG" : "image";
  const generateCount = models.length * platforms.length * variants;
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pickedAssets, setPickedAssets] = useState<string[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedImages, setImportedImages] = useState<string[]>(
    initialReferenceUrls ?? [],
  );
  const [pickedImported, setPickedImported] = useState<string[]>(
    initialReferenceUrls ?? [],
  );
  const [importedContext, setImportedContext] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState<"auto" | Complexity>("auto");
  const usesSettings = models.some(takesSettings);
  const { auto: autoSettings, loading: autoLoading } = useAutoImageSettings({
    enabled: usesSettings,
    brandId,
    brief,
    hasReferences: pickedAssets.length + pickedImported.length + files.length > 0,
    output,
  });

  const uploadBytes = files.reduce((sum, f) => sum + f.size, 0);
  const uploadsTooLarge = uploadBytes > MAX_UPLOAD_BYTES;

  const brandAssets = assets.filter((a) => a.brandId === brandId);
  const brandName = brands.find((b) => b.id === brandId)?.name ?? "";
  // Custom sizes live in `platforms` like presets do; unticking one drops it.
  const customPlatforms = platforms.filter((p) => p.startsWith("custom-"));

  function addCustomSize() {
    const w = Number(customW);
    const h = Number(customH);
    const problem = customSizeError(w, h);
    if (problem) {
      setCustomError(problem);
      return;
    }
    const id = customPlatformId(w, h);
    setPlatforms((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCustomW("");
    setCustomH("");
    setCustomError(null);
  }

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  // Append image files (drag-drop or click-to-browse), deduped by name+size.
  function addFiles(incoming: FileList | File[]) {
    const imgs = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...imgs.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function importFromUrl() {
    const url = importUrl.trim();
    if (!url || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/images/scrape-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      const imgs: string[] = data.images ?? [];
      setImportedImages(imgs);
      setPickedImported(imgs); // pre-select all; user can deselect
      setImportedContext(typeof data.context === "string" ? data.context : "");
      if (imgs.length === 0 && !data.context)
        setImportError("No usable images or context found on that page.");
      else if (imgs.length === 0)
        setImportError("No images found, but the page context was captured.");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function generate() {
    if (!brandId || !brief.trim() || models.length === 0 || platforms.length === 0) {
      setError("Pick a brand, write a brief, and select at least one model and platform.");
      return;
    }
    // Catch the oversized request here rather than let the platform bounce it.
    if (uploadsTooLarge) {
      setError(uploadTooLargeMessage(files));
      setStatus("error");
      return;
    }
    setStatus("running");
    setError(null);
    setOutputs([]);

    const fd = new FormData();
    fd.set("brandId", brandId);
    fd.set("brief", brief);
    models.forEach((m) => fd.append("modelIds", m));
    platforms.forEach((p) => fd.append("platforms", p));
    fd.set("variants", String(variants));
    fd.set("output", output);
    const settings = usesSettings ? effectiveSettings(planning, autoSettings) : null;
    if (settings) fd.set("settings", JSON.stringify(settings));
    if (output === "gif") {
      fd.set("frames", String(frames));
      fd.set("frameMs", String(frameMs));
    }
    pickedAssets.forEach((a) => fd.append("assetIds", a));
    pickedImported.forEach((u) => fd.append("importedUrls", u));
    if (importedContext.trim()) fd.set("importedContext", importedContext);
    if (templateId) fd.set("templateId", templateId);
    files.forEach((f) => fd.append("files", f));

    try {
      const res = await fetch("/api/images/generate", { method: "POST", body: fd });

      // Bad input / access errors come back as a plain JSON body, not a stream.
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
        throw new Error(await failureMessage(res, files));
      }

      // Stream: images arrive one-by-one; fill the grid as each lands.
      let count = 0;
      const errs: string[] = [];
      await readSse<
        | { type: "start"; id: string }
        | ({ type: "image" } & Output)
        | { type: "error"; message: string }
        | { type: "done"; count: number }
      >(res.body, (ev) => {
        if (ev.type === "image") {
          count += 1;
          const { model, platform, variant, url, settings } = ev;
          setOutputs((o) => [...o, { model, platform, variant, url, settings }]);
        } else if (ev.type === "error") {
          errs.push(ev.message);
        }
      });

      setStatus("done");
      if (count === 0) {
        const detail = [...new Set(errs.filter(Boolean))].join(" · ");
        setError(
          detail
            ? `No images came back — ${detail}`
            : "No images came back. Check the model keys and try again.",
        );
        setStatus("error");
      }
    } catch (err) {
      setStatus("error");
      // fetch() itself only rejects on a network failure, with a cryptic
      // "Failed to fetch"; everything else already carries a readable message.
      setError(
        err instanceof TypeError
          ? "Couldn't reach the server. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : "Generation failed",
      );
    }
  }

  const inputCls =
    "u-transition rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";
  const referenceCount = pickedAssets.length + pickedImported.length + files.length;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:gap-10">
      <div className="space-y-5">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Brand
          <select
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setPickedAssets([]);
            }}
            className={inputCls}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Creative brief
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder="Describe the subject, setting, mood, and any must-have details."
            className={inputCls}
          />
          <span className="leading-5 text-zinc-500">
            Be specific about the outcome; the brand context is added automatically.
          </span>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-zinc-600">Formats</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
            {PLATFORMS.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-zinc-900">
              <input
                type="checkbox"
                checked={platforms.includes(p.id)}
                onChange={() => toggle(platforms, setPlatforms, p.id)}
              />
              {p.label}
            </label>
          ))}
            {customPlatforms.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm text-zinc-900">
                <input
                  type="checkbox"
                  checked
                  onChange={() => setPlatforms((prev) => prev.filter((x) => x !== id))}
                />
                {platformLabel(id)}
              </label>
            ))}
          </div>
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={CUSTOM_MIN_EDGE}
                max={CUSTOM_MAX_EDGE}
                value={customW}
                onChange={(e) => setCustomW(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), !isImeEnter(e) && addCustomSize())}
                placeholder="Width"
                aria-label="Custom width in pixels"
                className={`${inputCls} w-0 min-w-0 flex-1`}
              />
              <span className="text-sm text-zinc-500">×</span>
              <input
                type="number"
                inputMode="numeric"
                min={CUSTOM_MIN_EDGE}
                max={CUSTOM_MAX_EDGE}
                value={customH}
                onChange={(e) => setCustomH(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), !isImeEnter(e) && addCustomSize())}
                placeholder="Height"
                aria-label="Custom height in pixels"
                className={`${inputCls} w-0 min-w-0 flex-1`}
              />
              <Button label="Add" onClick={addCustomSize} isDisabled={!customW || !customH} />
            </div>
            {customError ? (
              <p className="text-xs text-amber-600">{customError}</p>
            ) : (
              <p className="text-xs leading-5 text-zinc-500">
                Any size in px, up to 3:1. GPT Image 2.5 and 2.6 render the exact shape; other
                models are cropped to it.
              </p>
            )}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2 lg:grid-cols-1">
          <fieldset className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <legend className="text-xs text-zinc-600">Output</legend>
            <SegmentedControl
              label="Output"
              size="sm"
              value={output}
              onChange={(v) => chooseOutput(v as OutputKind)}
            >
              {OUTPUT_KINDS.map((k) => (
                <SegmentedControlItem key={k.id} value={k.id} label={k.label} />
              ))}
            </SegmentedControl>
            <p className="text-xs leading-5 text-zinc-500">
              {OUTPUT_KINDS.find((k) => k.id === output)?.hint}
            </p>
            {output === "gif" && (
              <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
                <div className="space-y-1">
                  <span className="block text-xs text-zinc-600">Frames</span>
                  <SegmentedControl
                    label="Frames"
                    size="sm"
                    value={String(frames)}
                    onChange={(v) => setFrames(Number(v))}
                  >
                    {GIF_FRAME_OPTIONS.map((n) => (
                      <SegmentedControlItem key={n} value={String(n)} label={String(n)} />
                    ))}
                  </SegmentedControl>
                </div>
                <div className="space-y-1">
                  <span className="block text-xs text-zinc-600">Speed</span>
                  <SegmentedControl
                    label="Speed"
                    size="sm"
                    value={String(frameMs)}
                    onChange={(v) => setFrameMs(Number(v))}
                  >
                    {GIF_SPEED_OPTIONS.map((sp) => (
                      <SegmentedControlItem
                        key={sp.frameMs}
                        value={String(sp.frameMs)}
                        label={sp.label}
                      />
                    ))}
                  </SegmentedControl>
                </div>
                <p className="w-full text-xs leading-5 text-zinc-500">
                  {((frames * frameMs) / 1000).toFixed(1)}s loop. More frames means smaller
                  frames: they share one render.
                </p>
              </div>
            )}
          </fieldset>

          <ImageModelSelect
            selected={models}
            onChange={setModels}
            isAvailable={(id) => supportsOutput(id, output)}
            unavailableNote={`${unitWord} output needs GPT Image 2.6`}
          />

          {usesSettings && (
            <PlanningControl
              choice={planning}
              onChange={setPlanning}
              auto={autoSettings}
              loading={autoLoading}
            />
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs text-zinc-600">Versions per format</legend>
            <SegmentedControl
              label="Versions per format"
              size="sm"
              value={String(variants)}
              onChange={(v) => setVariants(Number(v))}
            >
              {[1, 2, 3, 4].map((n) => (
                <SegmentedControlItem key={n} value={String(n)} label={String(n)} />
              ))}
            </SegmentedControl>
          </fieldset>
        </div>

        <details
          open={Boolean(initialReferenceUrls?.length)}
          className="group rounded-lg border border-zinc-200 bg-white"
        >
          <summary className="u-transition flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
            <span>
              References <span className="font-normal text-zinc-500">(optional)</span>
              {output === "svg" && (
                <span className="block text-xs font-normal text-amber-700">
                  Not used for {unitWord} output: OpenAI only takes references for stills and GIFs.
                </span>
              )}
            </span>
            <span className="text-xs font-normal text-zinc-500">
              {referenceCount > 0 ? `${referenceCount} selected` : "Add images"}
            </span>
          </summary>
          <div className="space-y-5 border-t border-zinc-200 p-4">
          {brandAssets.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-zinc-600">Brand reference assets</legend>
            <div className="flex flex-wrap gap-2">
              {brandAssets.map((a) => {
                const on = pickedAssets.includes(a.id);
                return (
                  <Button
                    key={a.id}
                    label={a.label}
                    variant="ghost"
                    onClick={() => toggle(pickedAssets, setPickedAssets, a.id)}
                    className={`h-16 w-16 overflow-hidden border-2 p-0 ${on ? "border-zinc-900 shadow-card" : "border-zinc-200 hover:border-zinc-300"}`}
                    tooltip={on ? `${a.label}, click to remove` : a.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img loading="lazy" decoding="async" src={a.url} alt="" className="size-15 object-cover" />
                    {on && (
                      <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold leading-none text-zinc-50">
                        ✕
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Import images from a product / collection URL
            <div className="flex gap-2">
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://acmeflorals.example/product/love-blossom"
                className={`${inputCls} flex-1`}
              />
              <Button
                label={importing ? "Reading…" : "Import"}
                onClick={importFromUrl}
                isDisabled={importing || !importUrl.trim()}
              >
                {importing ? <span className="u-shimmer">Reading…</span> : undefined}
              </Button>
            </div>
          </label>
          {importError && <p className="text-xs text-amber-600">{importError}</p>}
          {importedImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {importedImages.map((u) => {
                const on = pickedImported.includes(u);
                return (
                  <Button
                    key={u}
                    label={on ? "Selected" : "Click to use"}
                    variant="ghost"
                    onClick={() => toggle(pickedImported, setPickedImported, u)}
                    className={`h-16 w-16 overflow-hidden border-2 p-0 ${on ? "border-zinc-900 opacity-100 shadow-card" : "border-zinc-200 opacity-50 hover:opacity-80"}`}
                    tooltip={on ? "Selected" : "Click to use"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="size-15 object-cover" />
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-zinc-600">
          Upload images
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`u-transition flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-6 text-center text-sm ${
              dragging
                ? "border-zinc-600 bg-zinc-100 text-zinc-900"
                : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400"
            }`}
          >
            <span>Drag &amp; drop images here, or click to browse</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addFiles(e.target.files ?? []);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <Button
                  key={`${f.name}:${f.size}:${i}`}
                  label={f.name}
                  variant="ghost"
                  onClick={() => removeFile(i)}
                  className="h-16 w-16 overflow-hidden border-2 border-zinc-200 p-0 hover:border-zinc-300"
                  tooltip={`${f.name}, click to remove`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    className="size-15 object-cover"
                  />
                  <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold leading-none text-zinc-50">
                    ✕
                  </span>
                </Button>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <p className={uploadsTooLarge ? "text-red-600" : "text-zinc-500"}>
              {formatMb(uploadBytes)} of {formatMb(MAX_UPLOAD_BYTES)} max
              {uploadsTooLarge && ", remove an image or upload smaller versions"}
            </p>
          )}
        </div>
          </div>
        </details>

        <Button
          label={
            status === "running"
              ? `Generating ${generateCount} ${unitWord}${generateCount > 1 ? "s" : ""}…`
              : `Generate ${generateCount} ${unitWord}${generateCount > 1 ? "s" : ""}`
          }
          variant="primary"
          width="100%"
          onClick={generate}
          isDisabled={status === "running"}
        >
          {status === "running" ? (
            <span className="u-shimmer">
              Generating {generateCount} {unitWord}
              {generateCount > 1 ? "s" : ""}…
            </span>
          ) : undefined}
        </Button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="min-w-0">
        {status === "idle" && (
          <div className="flex min-h-96 items-center justify-center rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <div>
              <p className="text-sm font-medium text-zinc-700">Your creative will appear here</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">Choose your formats, add references if needed, and describe the outcome you want.</p>
            </div>
          </div>
        )}
        {status === "running" && (
          <div className="flex min-h-96 items-center justify-center rounded-xl border border-zinc-200 bg-white p-8">
            <p className="u-shimmer w-fit text-sm font-medium">
              Generating in parallel. Image models usually take 10 to 30 seconds.
            </p>
          </div>
        )}
        {outputs.length > 0 && (
          <ResultGrid outputs={outputs} platforms={platforms} brandName={brandName} />
        )}
      </div>
    </div>
  );
}

function ResultGrid({
  outputs,
  platforms,
  brandName,
}: {
  outputs: Output[];
  platforms: string[];
  brandName: string;
}) {
  return (
    <div className="space-y-8">
      {platforms.map((p) => {
        const forPlatform = outputs.filter((o) => o.platform === p);
        if (forPlatform.length === 0) return null;
        return (
          <div key={p}>
            <h3 className="mb-2 text-sm font-medium text-zinc-700">
              {platformLabel(p)}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {forPlatform.map((o) => (
                <figure
                  key={`${o.model}-${o.platform}-${o.variant ?? 1}`}
                  className="animate-enter overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-card"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.url} alt={imageModelLabel(o.model)} className="w-full" />
                  <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-zinc-600">
                    <span>
                      {imageModelLabel(o.model)}
                      {o.variant && forPlatform.filter((x) => x.model === o.model).length > 1
                        ? ` · v${o.variant}`
                        : ""}
                      {planningCaption(o.settings)}
                    </span>
                    <ImageDownloadLinks
                      url={o.url}
                      name={`${brandName} ${platformLabel(p)} ${imageModelLabel(o.model)} v${o.variant ?? 1}`}
                    />
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
