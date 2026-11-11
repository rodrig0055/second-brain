"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";

export type VariantInfo = { id: string; label: string; blurb?: string };
export type FieldInfo = { name: string; label: string; kind?: string; hint?: string };

/**
 * One block in the gallery: its designs, rendered live.
 *
 * The iframe sizes itself from a postMessage the preview document sends, because
 * a block's height is entirely a function of which design is showing. A fixed
 * height would clip the gift guide and leave a gap under a button.
 */
export function BlockCard({
  previewBase, kind, label, category, blurb, variants, fields, items, productSlots,
}: {
  previewBase: string;
  kind: string;
  label: string;
  category: string;
  blurb: string;
  variants: VariantInfo[];
  fields: FieldInfo[];
  items: { label: string; max: number } | null;
  productSlots: string | null;
}) {
  const [variant, setVariant] = useState(variants[0]?.id ?? "");
  // The email is 600px but the mobile breakpoint is 640px, so a 600px viewport
  // fires the phone rules and every gutter collapses to 4px. The desktop frame
  // is therefore 760px with the email centred inside it, which is what a real
  // desktop client does. Rendering it at 600 was showing mobile all along.
  const [width, setWidth] = useState<760 | 400>(760);
  const [height, setHeight] = useState(240);
  const [avail, setAvail] = useState(0);
  const shell = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== "nl-block-height" || d.kind !== kind) return;
      const h = Number(d.height);
      if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(h, 40), 3000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [kind]);

  // How much room the card actually has. The frame is always rendered at its
  // true width and scaled down to fit, never squeezed: an iframe narrowed to
  // the column would cross the 640px media query and quietly show the mobile
  // layout while the toggle still said desktop.
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = avail > 0 && avail < width ? avail / width : 1;

  const src = `${previewBase}?kind=${encodeURIComponent(kind)}&variant=${encodeURIComponent(variant)}`;
  const current = variants.find((v) => v.id === variant);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">{label}</h3>
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.6875rem] text-zinc-600">{kind}</code>
        <span className="text-[0.6875rem] uppercase tracking-wide text-zinc-400">{category}</span>
        <span className="ml-auto text-[0.6875rem] text-zinc-400">
          {variants.length} design{variants.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="px-4 pt-3 text-xs text-zinc-600">{blurb}</p>

      <div className="flex flex-wrap items-center gap-1 px-4 pt-3">
        {variants.map((v) => (
          <Button key={v.id} label={v.label} size="sm" onClick={() => setVariant(v.id)}
            aria-pressed={v.id === variant} tooltip={v.blurb}
            variant={v.id === variant ? "primary" : "secondary"} />
        ))}
        <span className="ml-auto inline-flex">
          <SegmentedControl label="Preview width" size="sm" value={String(width)}
            onChange={(v) => setWidth(v === "400" ? 400 : 760)}>
            <SegmentedControlItem value="760" label="Desktop width" isLabelHidden icon={<Icon icon={Monitor} />} />
            <SegmentedControlItem value="400" label="Phone width" isLabelHidden icon={<Icon icon={Smartphone} />} />
          </SegmentedControl>
        </span>
      </div>

      {current?.blurb && (
        <p className="px-4 pt-1.5 text-[0.6875rem] text-zinc-400">{current.blurb}</p>
      )}

      <div className="px-4 py-3">
        {/* The ref sits on an unpadded element: clientWidth includes padding,
            so measuring the padded card scaled the frame 32px too wide and
            clipped the right-hand tile of every grid. */}
        <div ref={shell} className="w-full" />
        <div
          className="mx-auto overflow-hidden rounded border border-zinc-200"
          style={{ width: width * scale, height: height * scale }}
        >
          <iframe
            key={`${kind}-${variant}`}
            title={`${label}, ${current?.label ?? variant}`}
            src={src}
            loading="lazy"
            scrolling="no"
            className="block border-0 bg-white"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
        {scale < 1 && (
          <p className="mt-1.5 text-center text-[0.6875rem] text-zinc-400">
            shown at {Math.round(scale * 100)}%, {width === 760 ? "desktop viewport 760px" : "phone viewport 400px"}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-zinc-100 px-4 py-3 text-[0.6875rem]">
        <dt className="text-zinc-400">Fields</dt>
        <dd className="text-zinc-700">
          {fields.length === 0 ? <span className="text-zinc-400">none</span> : fields.map((f) => f.label).join(", ")}
        </dd>
        {items && (
          <>
            <dt className="text-zinc-400">Repeats</dt>
            <dd className="text-zinc-700">{items.label}, up to {items.max}</dd>
          </>
        )}
        {productSlots && (
          <>
            <dt className="text-zinc-400">Products</dt>
            <dd className="text-zinc-700">
              {productSlots === "grid" ? "a grid, rows must be full" : "one product"}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
