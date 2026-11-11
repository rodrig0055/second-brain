/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload run
   before the module system is patched; it cannot use ESM imports. */
// `server-only` is a bundler-only guard that Next.js aliases at build time; there
// is no standalone package to resolve. Scripts that import server modules under
// plain tsx need it stubbed, so preload this:
//
//   npx tsx --env-file=.env.local --require ./scripts/_server-only-shim.cjs <script>
//
// Safe by construction: outside the bundler there is no client bundle to protect.
const Module = require("node:module");
const original = Module._resolveFilename;
const noop = require.resolve("./_server-only-noop.cjs");

Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only" || request === "client-only") return noop;
  return original.call(this, request, ...rest);
};
