import type { NextConfig } from "next";
import path from "path";
import withStylexTurbopack from "@stylexswc/nextjs-plugin/turbopack";

/**
 * Baseline security headers on every response. Vercel already sends HSTS, so it is not repeated.
 *
 * Framing is same-origin only: the newsletter editor embeds the app's own preview route in an
 * iframe, and nothing outside the app has a reason to frame it. `frame-ancestors` is the real
 * control; X-Frame-Options covers clients that predate it. This is deliberately not a full CSP:
 * a script-src policy needs a report-only run against real traffic first, or it breaks the app.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the app uses these; denying them means injected code cannot either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  // sharp is a native module; keep it out of the server bundle so its
  // platform-specific binaries load correctly at runtime.
  serverExternalPackages: ["sharp"],
  // @sparticuz/chromium reads its brotli-packed Chromium from bin/ by path, so
  // the tracer cannot see it. Page reads (src/lib/fetch-page.ts) reach many
  // routes through the agent's web tools, so include it everywhere.
  // playwright-core likewise require()s browsers.json at load time; without it
  // every headless fallback dies with "Cannot find module .../browsers.json",
  // so any site that blocks Vercel's plain fetch (bloomly-ph.example) could not be read.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@sparticuz/chromium/bin/**",
      "./node_modules/playwright-core/browsers.json",
    ],
  },
};

/**
 * StyleX (Astryx page templates and `stylex.create` in app code). Under Turbopack this loader only
 * compiles StyleX calls; the CSS is extracted by @stylexswc/postcss-plugin (postcss.config.mjs) into
 * src/app/stylex.css. Only app source is compiled: Astryx ships prebuilt CSS (astryx.css), and
 * its package source must never be recompiled.
 */
export default withStylexTurbopack({
  rsOptions: {
    dev: process.env.NODE_ENV === "development",
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["**/*.test.ts", "src/app/api/**"],
  },
})(nextConfig);
