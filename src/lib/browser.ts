import type { Browser } from "playwright-core";

/**
 * Headless Chromium for pages a plain fetch cannot read (JS-rendered SPAs,
 * Cloudflare challenges). Replaces the paid Firecrawl scrape.
 *
 * On Vercel (Linux) the binary comes from @sparticuz/chromium, which is
 * version-matched to playwright-core (Chromium 153 ↔ playwright-core 1.63):
 * bump them together. Elsewhere (local macOS dev) it uses the installed Google
 * Chrome, or CHROMIUM_EXECUTABLE_PATH when set.
 *
 * The browser is shared across requests in the same warm instance (Fluid
 * compute reuses it); each caller gets its own context, which it must close.
 */
let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  const { chromium: playwright } = await import("playwright-core");
  if (process.platform === "linux" && !process.env.CHROMIUM_EXECUTABLE_PATH) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return playwright.launch({
      // --single-process crashes Playwright ("Target page, context or browser
      // has been closed") whenever a page swaps renderer, e.g. the reload a
      // Cloudflare check does. Multi-process works on Vercel's Linux runtime.
      args: chromium.args.filter((a) => a !== "--single-process"),
      executablePath: await chromium.executablePath(),
    });
  }
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  return playwright.launch(executablePath ? { executablePath } : { channel: "chrome" });
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing?.isConnected()) return existing;
  }
  browserPromise = launch();
  const browser = await browserPromise.catch((err) => {
    browserPromise = null;
    throw err;
  });
  browser.on("disconnected", () => {
    browserPromise = null;
  });
  return browser;
}
