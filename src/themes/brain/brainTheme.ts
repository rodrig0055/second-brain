import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

/**
 * Second Brain theme: Astryx Neutral with the app's established type and radius scale.
 *
 * The Tailwind bridge (@astryxdesign/core/tailwind-theme.css) maps text-xs/sm/base/lg and
 * rounded-sm/md/lg/xl onto these tokens, so they must match the sizes the existing pages were
 * designed at (Tailwind's 12/14/16/18px text, the app's 6/9/12/16px radii). Neutral's own scale
 * (10/12/14px text, 28px page radius) shrank labels to 10px across ~1,300 legacy class uses.
 *
 * Edit this file, then rebuild: `npx astryx theme build src/themes/brain/brainTheme.ts`.
 * Rebuild after every Astryx upgrade too; the built CSS is not repaired at runtime.
 */
const SANS_FALLBACKS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const brainTheme = defineTheme({
  name: "brain",
  extends: neutralTheme,
  tokens: {
    // Figtree (Neutral's face), self-hosted by next/font in src/app/layout.tsx, which exposes it
    // as --font-figtree. Astryx never loads fonts; next/font avoids a runtime Google Fonts call.
    "--font-family-body": `var(--font-figtree), ${SANS_FALLBACKS}`,
    "--font-family-heading": `var(--font-figtree), ${SANS_FALLBACKS}`,
    // Type scale: matches Tailwind's defaults, which the legacy surfaces use.
    "--font-size-xs": "0.75rem",
    "--font-size-sm": "0.875rem",
    "--font-size-base": "1rem",
    "--font-size-lg": "1.125rem",
    "--font-size-xl": "1.25rem",
    "--font-size-2xl": "1.5rem",
    // Radius scale: bridge maps rounded-sm/md/lg/xl to inner/element/container/page.
    "--radius-inner": "6px",
    "--radius-element": "9px",
    "--radius-container": "12px",
    "--radius-page": "16px",
  },
});
