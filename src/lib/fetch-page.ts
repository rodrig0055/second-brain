import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { getBrowser } from "@/lib/browser";

const MAX_CHARS = 8000;

// Page reads are free and self-hosted: a plain fetch first (fast, and enough for
// our own server-rendered storefronts, sitemaps and feeds), falling back to
// headless Chromium via Playwright only when the fetch is blocked (Cloudflare
// challenge, 403) or the HTML is an empty JS shell. Firecrawl is now used only
// for web search, below.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export type PageMetadata = {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
};

type LoadedPage = { body: string; finalUrl: string };

function normalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

const CHALLENGE_RE =
  /<title>\s*(?:just a moment|attention required|access denied)|cf-chl-|challenge-platform|cf_chl_opt/i;

/** True when a fetched body is a bot-protection interstitial, not the page. */
export function isChallengePage(body: string): boolean {
  return CHALLENGE_RE.test(body.slice(0, 20000));
}

/**
 * True when HTML carries almost no visible text, i.e. a client-rendered shell
 * whose content only appears after JavaScript runs.
 */
export function looksEmpty(html: string): boolean {
  const text = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 200;
}

async function plainFetch(
  target: string,
  timeoutMs: number,
): Promise<{
  status: number;
  body: string;
  finalUrl: string;
  isHtml: boolean;
  contentType: string | null;
} | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await res.text();
    const contentType = res.headers.get("content-type");
    const isHtml = (contentType ?? "").includes("html");
    return { status: res.status, body, finalUrl: res.url || target, isHtml, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Loads a page in headless Chromium. `raw` returns the exact response body
 * (for XML sitemaps/feeds, re-fetched from inside the page so it carries any
 * challenge-clearance cookies); otherwise the rendered DOM, which includes
 * JS-inserted content such as lazy product galleries.
 */
async function browserLoad(
  target: string,
  raw: boolean,
  timeoutMs: number,
): Promise<LoadedPage | null> {
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US" });
    const page = await context.newPage();
    // Images/fonts/media are never needed: we read markup, not pixels.
    await page.route("**/*", (route) =>
      ["image", "font", "media"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give a Cloudflare challenge a few seconds to clear itself.
    for (let i = 0; i < 8 && isChallengePage(await page.content()); i++) {
      await page.waitForTimeout(1000);
    }
    if (raw) {
      const body = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: "include" });
        return r.ok ? r.text() : null;
      }, target);
      return body && !isChallengePage(body) ? { body, finalUrl: page.url() } : null;
    }
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const body = await page.content();
    return isChallengePage(body) ? null : { body, finalUrl: page.url() };
  } catch (err) {
    console.error("browserLoad failed", target, err);
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Fetch a URL's markup: plain fetch first, headless Chromium when the fetch is
 * blocked or (for HTML) returns an empty JS shell. Returns null on failure so
 * callers degrade gracefully.
 */
async function loadPage(
  url: string,
  { raw = false, timeoutMs = 45000 }: { raw?: boolean; timeoutMs?: number } = {},
): Promise<LoadedPage | null> {
  const target = normalizeUrl(url);
  if (!target) return null;

  const res = await plainFetch(target, timeoutMs);
  if (
    res &&
    res.status >= 200 &&
    res.status < 300 &&
    !isChallengePage(res.body) &&
    !(res.isHtml && !raw && looksEmpty(res.body))
  ) {
    return { body: res.body, finalUrl: res.finalUrl };
  }
  // A real 404/410 will not get better in a browser.
  if (res && (res.status === 404 || res.status === 410)) return null;
  console.warn(
    "plainFetch fell back to browser",
    target,
    res ? `status=${res.status} challenge=${isChallengePage(res.body)} len=${res.body.length}` : "network error",
  );
  return browserLoad(target, raw, timeoutMs);
}

/** What a URL actually returns, for health checks (see the checkUrls tool). */
export type UrlStatus = {
  url: string;
  /** Final HTTP status after redirects; null when the URL could not be reached. */
  status: number | null;
  finalUrl: string | null;
  redirected: boolean;
  contentType: string | null;
  /** "fetch" = plain request; "browser" = headless Chromium past a bot check. */
  via: "fetch" | "browser" | null;
  note?: string;
};

/**
 * A "soft 404": the URL redirects to an error page that answers 200. bloomly-ph.example
 * does this for every missing page (to /error/page-not-found), so the status
 * alone would call a dead link healthy.
 */
function softNotFound(finalUrl: string, target: string): { note?: string } {
  if (finalUrl === target) return {};
  const path = (() => {
    try {
      return new URL(finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return /(^|\/)(error|404|not-?found|page-not-found)(\/|$|\.)/.test(path)
    ? { note: `soft 404: redirects to an error page (${path}) that returns 200; the requested page does not exist` }
    : {};
}

/**
 * Status of one URL. Plain fetch first; when that gets a bot-protection page
 * (bloomly-ph.example answers Vercel's servers with a Cloudflare 403), the status a real
 * visitor sees is read with headless Chromium instead, so a challenge is never
 * reported as the site being down.
 */
export async function checkUrlStatus(url: string, timeoutMs = 30000): Promise<UrlStatus> {
  const target = normalizeUrl(url);
  const base = { url, finalUrl: null, redirected: false, contentType: null } as const;
  if (!target) return { ...base, status: null, via: null, note: "not an http(s) URL" };

  const res = await plainFetch(target, timeoutMs);
  if (res && !isChallengePage(res.body)) {
    return {
      url,
      status: res.status,
      finalUrl: res.finalUrl,
      redirected: res.finalUrl !== target,
      contentType: res.contentType,
      via: "fetch",
      ...softNotFound(res.finalUrl, target),
    };
  }

  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US" });
    const page = await context.newPage();
    // The last main-frame document response is what a visitor ends up on,
    // after any challenge reload and redirects.
    let last: { status: number; url: string; type: string | null } | null = null;
    page.on("response", (r) => {
      if (r.request().resourceType() === "document" && r.frame() === page.mainFrame()) {
        last = { status: r.status(), url: r.url(), type: r.headers()["content-type"] ?? null };
      }
    });
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    for (let i = 0; i < 8 && isChallengePage(await page.content()); i++) {
      await page.waitForTimeout(1000);
    }
    const stillChallenged = isChallengePage(await page.content());
    const final = last as { status: number; url: string; type: string | null } | null;
    return {
      url,
      status: final?.status ?? null,
      finalUrl: final?.url ?? page.url(),
      redirected: (final?.url ?? page.url()) !== target,
      contentType: final?.type ?? null,
      via: "browser",
      ...softNotFound(final?.url ?? page.url(), target),
      ...(stillChallenged
        ? {
            note:
              "still behind a bot check after waiting: our server was challenged, so the page's real status is UNKNOWN. This is not evidence that visitors or search engines are blocked; check Search Console impressions for this URL before claiming that.",
          }
        : {}),
    };
  } catch (err) {
    return {
      ...base,
      status: res?.status ?? null,
      via: null,
      note: `could not load in the browser (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); this is a tool failure, not proof the page is down`,
    };
  } finally {
    await context?.close().catch(() => {});
  }
}

/** title / description / og:* from a page's <head>. */
export function extractMetadata(html: string, base: URL): PageMetadata {
  const { document } = parseHTML(html);
  const meta = (sel: string) =>
    document.querySelector(sel)?.getAttribute("content")?.trim() || undefined;
  let ogImage = meta('meta[property="og:image"]') ?? meta('meta[name="og:image"]');
  if (ogImage) {
    try {
      ogImage = new URL(ogImage, base).toString();
    } catch {
      ogImage = undefined;
    }
  }
  return {
    title: document.querySelector("title")?.textContent?.trim() || undefined,
    description: meta('meta[name="description"]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogImage,
  };
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/**
 * Readable markdown for a page. Uses Readability's article extraction when it
 * finds a substantial article (blogs, docs); otherwise the whole body minus
 * scripts and page chrome, which keeps product pages' price/variant text.
 */
export function htmlToMarkdown(html: string, base: URL): string {
  const { document } = parseHTML(html);
  try {
    if (!document.querySelector("base")) {
      const b = document.createElement("base");
      b.setAttribute("href", base.toString());
      document.head?.appendChild(b);
    }
    const article = new Readability(document.cloneNode(true) as Document).parse();
    if (article?.content && (article.textContent ?? "").trim().length > 500) {
      const md = turndown.turndown(article.content).trim();
      return article.title ? `# ${article.title.trim()}\n\n${md}` : md;
    }
  } catch {
    // Fall through to the whole-body conversion.
  }
  for (const el of document.querySelectorAll(
    "script, style, noscript, template, svg, iframe, nav, header, footer",
  )) {
    el.remove();
  }
  const root = document.querySelector("main") ?? document.body;
  return root ? turndown.turndown(root.innerHTML ?? "").trim() : "";
}

/**
 * Raw HTML/XML of a URL. Used to pull the storefront sitemaps and product feeds.
 * Returns null when the fetch fails. `timeoutMs` is bumped for large feeds.
 */
export async function scrapeRawHtml(
  url: string,
  timeoutMs = 90000,
): Promise<string | null> {
  const page = await loadPage(url, { raw: true, timeoutMs });
  return page?.body ?? null;
}

/**
 * Clean markdown for a URL, capped to `maxChars` to bound token use. Backs the
 * agent's generic web-fetch tool. Returns null on failure.
 */
export async function scrapeMarkdown(
  url: string,
  maxChars = 12000,
): Promise<string | null> {
  const page = await loadPage(url);
  if (!page) return null;
  const md = htmlToMarkdown(page.body, new URL(page.finalUrl));
  if (!md) return null;
  return md.length > maxChars ? `${md.slice(0, maxChars)}\n…[truncated]` : md;
}

function buildContext(html: string, base: URL): string | null {
  const meta = extractMetadata(html, base);
  const title = meta.title;
  const ogTitle = meta.ogTitle;
  const metaDesc = meta.description ?? meta.ogDescription;
  const body = htmlToMarkdown(html, base).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);

  const parts = [
    title && `Title: ${title}`,
    ogTitle && ogTitle !== title && `OG title: ${ogTitle}`,
    metaDesc && `Meta description: ${metaDesc}`,
    body && `Page text: ${body}`,
  ].filter(Boolean);

  return parts.length ? parts.join("\n") : null;
}

// Headings that mark the start of cross-sell / related-product sections.
const CROSS_SELL_RE =
  /you may also like|you might also like|related product|frequently bought|complete the look|customers also (?:bought|viewed)/i;

export function collectImages(html: string, base: URL): string[] {
  const og = extractMetadata(html, base).ogImage;

  // Only scan markup BEFORE the first cross-sell section for gallery images.
  const cut = html.search(CROSS_SELL_RE);
  const scoped = cut > 0 ? html.slice(0, cut) : html;

  const found = new Set<string>();
  if (og) found.add(og.split("?")[0]);

  for (const m of scoped.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) {
    let u = m[1].trim();
    if (u.startsWith("//")) u = `https:${u}`;
    else if (u.startsWith("/")) u = new URL(u, base).toString();
    if (!u.startsWith("http") || u.startsWith("data:")) continue;
    const clean = u.split("?")[0];
    if (/\.svg($|\?)/i.test(clean)) continue;
    if (/icon|sprite|logo|favicon|placeholder|loader|spinner|banner|hub/i.test(clean))
      continue;
    // Skip size-prefixed thumbnails under 300px (e.g. "80_", "150_").
    const sizePrefix = clean.match(/\/(\d{2,4})_[^/]+$/);
    if (sizePrefix && Number(sizePrefix[1]) < 300) continue;
    found.add(clean);
  }

  // The main product's gallery is a handful of shots, not a whole catalog.
  return [...found].slice(0, 6);
}

/**
 * Page context for the model — title / meta / visible text.
 * Returns null on failure so generation continues.
 */
export async function fetchPageContext(url: string): Promise<string | null> {
  const page = await loadPage(url);
  if (!page) return null;
  return buildContext(page.body, new URL(page.finalUrl));
}

/**
 * Extracts the MAIN product image(s) from a page — for importing into Image
 * Studio as references. Leads with og:image, then the main product gallery,
 * with cross-sell/"you may also like" sections cut off. Skips data URIs,
 * icons/logos, and sub-300px thumbnails. Deduped, capped.
 */
export async function extractPageImages(url: string): Promise<string[]> {
  const page = await loadPage(url);
  if (!page) return [];
  return collectImages(page.body, new URL(page.finalUrl));
}

/**
 * Both images and context from a SINGLE page load — used by the studio's URL
 * import. `ok` is false when the page could not be read at all, so the UI can
 * tell "unreachable" apart from "read, but nothing usable".
 */
export async function scrapePage(
  url: string,
): Promise<{ ok: boolean; images: string[]; context: string | null }> {
  const page = await loadPage(url);
  if (!page) return { ok: false, images: [], context: null };
  const base = new URL(page.finalUrl);
  return {
    ok: true,
    images: collectImages(page.body, base),
    context: buildContext(page.body, base),
  };
}

const URL_RE = /^https?:\/\/\S+$/i;

/** Picks input values that are URLs, so the route can fetch them. */
export function urlInputs(inputs: Record<string, string>): string[] {
  return Object.values(inputs)
    .map((v) => v.trim())
    .filter((v) => URL_RE.test(v));
}

// ── Web search (still Firecrawl) ─────────────────────────────────────────────

const FIRECRAWL_BASE =
  process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev";

type SearchHit = {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string;
};

/** One web search result, carrying the page's own content when it could be read. */
export type SearchResult = {
  title: string;
  url: string;
  description: string;
  content?: string;
};

/**
 * Web search via Firecrawl's /v2/search. Passing `scrapeOptions` makes each hit
 * come back with its page content, so finding a source and reading it is ONE
 * round trip instead of a search followed by N fetches — which also keeps the
 * agent loop short enough to stay inside the task route's 300s budget.
 * Content is capped per result because this feeds a prompt: five uncapped pages
 * would dwarf the answer they are supposed to support.
 * Returns null when the key is missing or the call fails, so callers degrade.
 */
export async function firecrawlSearch(
  query: string,
  limit = 5,
  maxCharsPerResult = 4000,
  timeoutMs = 60000,
): Promise<SearchResult[] | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v2/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      // 500 chars is the API's query cap. onlyMainContent drops nav/footer so
      // the capped slice is signal rather than page chrome.
      body: JSON.stringify({
        query: query.slice(0, 500),
        limit,
        sources: ["web"],
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const hits = json?.data?.web;
    if (!json?.success || !Array.isArray(hits)) return null;

    const out: SearchResult[] = [];
    for (const hit of hits as SearchHit[]) {
      if (!hit.url) continue;
      const entry: SearchResult = {
        title: hit.title?.trim() ?? "",
        url: hit.url,
        description: hit.description?.trim() ?? "",
      };
      if (hit.markdown) {
        entry.content =
          hit.markdown.length > maxCharsPerResult
            ? `${hit.markdown.slice(0, maxCharsPerResult)}\n…[truncated]`
            : hit.markdown;
      }
      out.push(entry);
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
