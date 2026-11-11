/**
 * UI ratchet: files already moved to Astryx cannot slide back to hand-built UI.
 *
 * Applies ONLY to the paths in ASTRYX_SURFACES. Each Astryx migration PR adds the folders or files it
 * finished, so the guard grows with the migration (plan: brain/docs/astryx-ui-plan.md, task UG-03).
 * Everything not listed is untouched, so legacy screens keep linting as before.
 *
 * In every .tsx file under src (APP_WIDE_RULES): no raw <button>, no `u-press` class (UP-01).
 *
 * In a guarded file:
 * - no raw HTML for things Astryx owns (layout, text, buttons, inputs, tables, links, images, lists);
 * - no `style` on raw elements (data-driven values on Astryx components, e.g. a chart series colour on
 *   <Icon style={{color}}>, stay allowed);
 * - no Tailwind palette colours (`text-zinc-500`, `bg-white`) or arbitrary values (`text-[0.7rem]`,
 *   `p-[13px]`) in className: use token utilities (`text-secondary`, `bg-surface`, `p-4`) or props.
 *
 * A genuine exception takes a reasoned disable on the line:
 *   // eslint-disable-next-line no-restricted-syntax -- <why Astryx cannot do this>
 */

/** Migrated files and folders. Append in the PR that finishes them. */
export const ASTRYX_SURFACES = [
  "src/components/astryx-root.tsx",
  // UG-04 feedback layer
  "src/components/feedback/**",
  "src/components/confirm-dialog.tsx",
  "src/components/confirm-dialog-button.tsx",
  "src/app/global-error.tsx",
  "src/app/not-found.tsx",
  "src/app/(app)/error.tsx",
  "src/app/(app)/not-found.tsx",
  // UF-01 app frame
  "src/app/(app)/layout.tsx",
  "src/app/(app)/app-frame.tsx",
  // UF-02 page header
  "src/components/page-header.tsx",
  "src/components/route-header.tsx",
  "src/app/(app)/t/[team]/social/social-header.tsx",
  // UF-03 command palette
  "src/components/command-palette.tsx",
  // UP-02 side panels
  "src/components/ui/sheet.tsx",
  "src/components/ui/drawer.tsx",
  "src/components/ui/route-sheet.tsx",
  "src/components/ui/action-sheet.tsx",
  // UP-03 filters and pickers
  "src/components/ui/filter-pill.tsx",
  "src/components/ui/number-filter.tsx",
  "src/components/date-filter.tsx",
  "src/components/brand-multi-select.tsx",
  "src/components/image-model-select.tsx",
  "src/components/filter-bar.tsx",
  // UP-04 data table
  "src/components/data-table.tsx",
  // UP-05 status, empty, loading, KPI
  "src/components/status-badge.tsx",
  "src/components/empty-state.tsx",
  "src/components/skeleton.tsx",
  "src/components/kpi-tile.tsx",
  "src/app/(app)/**/loading.tsx",
  // Fixture used by src/lib/ui-guard.test.ts to prove the guard fires. Never a real file.
  "src/**/__ui_guard_fixture__.tsx",
];

const RAW_ELEMENTS = [
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "aside", "header", "footer", "nav",
  "input", "select", "textarea", "label", "fieldset",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "a", "img", "ul", "ol", "li", "hr", "dialog", "details", "summary",
];

// Tailwind palette colour utilities (the app's legacy palette) and arbitrary values like text-[0.7rem].
const PALETTE =
  "(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|decoration|caret|accent|shadow)-(?:white|black|(?:zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3})";
const ARBITRARY = "[a-z][a-z0-9-]*-\\[[^\\]]+\\]";
const CLASS_RE = `/(?:^|[\\s:])(?:${PALETTE}|${ARBITRARY})(?:$|[\\s/])/`;

const rawElement = `JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^(?:${RAW_ELEMENTS.join("|")})$/]`;

/**
 * App-wide primitives: once a primitive is on Astryx everywhere (UP-01 buttons), the hand-built version is
 * banned in every file, guarded or not. These selectors are repeated inside uiGuardConfig because ESLint
 * replaces (does not merge) a rule's options when a later config matches the same file.
 */
const APP_WIDE_RULES = [
  {
    selector: "JSXOpeningElement[name.type='JSXIdentifier'][name.name='button']",
    message: "Use Astryx <Button label=... /> or <IconButton /> (@astryxdesign/core), not a raw <button>.",
  },
  {
    selector: "JSXAttribute[name.name='className'] Literal[value=/(?:^|\\s)u-press(?:$|\\s)/]",
    message: "`u-press` is retired: Astryx Button has its own press feedback. Use <Button href> for a link that looks like a button.",
  },
  {
    selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(?:^|\\s)u-press(?:$|\\s)/]",
    message: "`u-press` is retired: Astryx Button has its own press feedback. Use <Button href> for a link that looks like a button.",
  },
];

export const appWideGuardConfig = {
  files: ["src/**/*.tsx"],
  rules: { "no-restricted-syntax": ["error", ...APP_WIDE_RULES] },
};

export const uiGuardConfig = {
  files: ASTRYX_SURFACES,
  rules: {
    "no-restricted-syntax": [
      "error",
      ...APP_WIDE_RULES,
      {
        selector: rawElement,
        message:
          "Astryx surface: use the Astryx component (VStack/HStack/Text/Heading/Button/TextInput/Selector/Table/Link/Thumbnail/List...) instead of raw HTML. `npx astryx search \"<what you need>\"`.",
      },
      {
        selector: `JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[a-z]/] > JSXAttribute[name.name='style']`,
        message: "Astryx surface: no inline style on raw elements. Use component props, xstyle (StyleX) or token utilities.",
      },
      {
        selector: `JSXAttribute[name.name='className'] Literal[value=${CLASS_RE}]`,
        message:
          "Astryx surface: no Tailwind palette colours or arbitrary values. Use token utilities (text-primary, text-secondary, bg-surface, border-border, rounded-lg) or component props.",
      },
      {
        selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=${CLASS_RE}]`,
        message:
          "Astryx surface: no Tailwind palette colours or arbitrary values. Use token utilities (text-primary, text-secondary, bg-surface, border-border, rounded-lg) or component props.",
      },
    ],
  },
};
