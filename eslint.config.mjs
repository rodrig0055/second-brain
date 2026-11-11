import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { appWideGuardConfig, uiGuardConfig } from "./eslint.ui-guard.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Astryx `theme build` output (regenerated, never hand-edited); the theme source stays linted.
    "src/themes/*/*.js",
    "src/themes/*/*.d.ts",
  ]),
  {
    // Astryx theme descriptors must be a bare default-exported object (`astryx theme add` rejects
    // anything else), which is exactly what this rule flags.
    files: ["src/themes/*/*.doc.mjs"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
  // Astryx ratchet (see eslint.ui-guard.mjs): primitives finished app-wide stay finished everywhere, and
  // migrated screens cannot regress to hand-built UI. Order matters: the guarded config must come last.
  appWideGuardConfig,
  uiGuardConfig,
]);

export default eslintConfig;
