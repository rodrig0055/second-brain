"use client";

import Link from "next/link";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { LayerProvider } from "@astryxdesign/core/Layer";
import "@astryxdesign/core/Toast";
import { themes, defaultThemeSlug } from "../astryx-themes";

const TOAST = { position: "bottomEnd", maxVisible: 3 } as const;

/**
 * Astryx app root: the theme for every component, Next.js <Link> for every Astryx link
 * (useLinkComponent resolves to it, so Astryx navigation stays client-side), and one LayerProvider
 * that owns the toast viewport (bottom end, three at a time) for `useNotify()` and `useToast()`.
 * The bare Toast import is what makes the provider mount its viewport.
 *
 * mode="light": the app has no dark mode yet, and legacy Tailwind surfaces are light-only.
 * When a dark mode ships, keep the mode in app state and pass it here (see
 * `npx astryx docs migration/component-migration`), never by toggling body classes.
 */
export function AstryxRoot({ children }: { children: React.ReactNode }) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <LayerProvider toast={TOAST}>
        <LinkProvider component={Link}>{children}</LinkProvider>
      </LayerProvider>
    </Theme>
  );
}
