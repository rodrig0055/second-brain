<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:app-ui-conventions -->
## UI conventions (Astryx design system)

- **Components first.** Use Astryx components and their props before any custom styling.
- **StyleX** is set up (`@stylexswc/nextjs-plugin/turbopack` in next.config.ts, `@stylexswc/postcss-plugin`
  in postcss.config.mjs, output in `src/app/stylex.css` inside the `components` layer). Use it for:
  layout scaffolded from Astryx page templates (`npx astryx template ...` keeps its `stylex.create`), the
  `xstyle` prop on Astryx components, and swizzled components. Read tokens from
  `@astryxdesign/core/theme/tokens.stylex`, never raw values.
- **Tailwind token utilities** (`text-primary`, `bg-surface`, `border-border`, `rounded-lg`, `p-4`) for small
  one-off layout in app pages that did not come from a template. Never `zinc-*` colours or arbitrary values.
- Only `src/**` is compiled by StyleX; Astryx package source is never recompiled (it ships `astryx.css`).
- After editing `src/themes/brain/brainTheme.ts` or upgrading Astryx: `npx astryx theme build src/themes/brain/brainTheme.ts`.
<!-- END:app-ui-conventions -->

<!-- ASTRYX:START -->
Astryx v0.7.11 · 174 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then Tailwind utilities backed by tokens. No raw hex/px.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any style={{…}}, raw <div>/<span>, imported .css/@apply, or hardcoded/arbitrary value (bg-[#fff], p-[13px]) with the component or a token-backed utility.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
