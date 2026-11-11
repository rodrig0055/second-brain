import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { firecrawlSearch, scrapeMarkdown, type SearchResult } from "@/lib/fetch-page";
import { getProviderApiKey } from "@/lib/llm-keys";
import { googleGroundingTools } from "@/lib/models";

/**
 * Web search with fallbacks, so the agent is never left to guess.
 *
 * Firecrawl is on a free plan whose credits run out, and when search silently
 * fails the agent fills the gap from memory. So searchWeb tries, in order:
 *   1. Firecrawl /v2/search (results come with page content)
 *   2. Gemini with Google Search grounding (the Google key the app already has)
 *   3. Ahrefs SERP overview (Google's top results for a query + country). Only
 *      covers keywords in Ahrefs' database, so long-tail queries can come back
 *      empty; it is the last resort, not a peer of Google grounding.
 * Providers 2 and 3 return links only, so their pages are read with our own
 * fetcher (plain fetch, then headless Chromium). A result whose page could not
 * be read keeps `content` undefined, and the caller says so.
 */

export type WebSearchProvider = "firecrawl" | "google" | "ahrefs";

export type WebSearchResponse = {
  provider: WebSearchProvider;
  results: SearchResult[];
  /** Providers tried before this one, with why each was skipped. */
  fallbacks: string[];
};

const GROUNDING_MODEL = "gemini-3.5-flash-lite";

/** Reads up to `limit` result pages in parallel, capped per page. */
async function hydrate(
  hits: { title: string; url: string; description: string }[],
  limit: number,
  maxChars: number,
): Promise<SearchResult[]> {
  const top = hits.slice(0, limit);
  const contents = await Promise.all(
    top.map((h) => scrapeMarkdown(h.url, maxChars).catch(() => null)),
  );
  return top.map((h, i) => (contents[i] ? { ...h, content: contents[i]! } : h));
}

/**
 * Grounding returns vertexaisearch redirect links, not the publisher URL. The
 * redirect's Location header is the real page, which is what we cite and read.
 */
export async function resolveRedirect(url: string): Promise<string> {
  if (!url.includes("grounding-api-redirect")) return url;
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.headers.get("location") ?? url;
  } catch {
    return url;
  }
}

export async function googleGroundedSearch(
  query: string,
): Promise<{ title: string; url: string; description: string }[] | null> {
  const apiKey = await getProviderApiKey("google");
  if (!apiKey) return null;
  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const { sources } = await generateText({
      model: google(GROUNDING_MODEL),
      // Search grounding only; url_context would let the model read pages
      // itself, but we want links back so our own fetcher reads them.
      tools: { google_search: googleGroundingTools().google_search },
      prompt: `Search the web for: ${query.slice(0, 500)}\nList the most relevant results.`,
      abortSignal: AbortSignal.timeout(45000),
    });
    const urlSources = sources.filter(
      (s): s is typeof s & { sourceType: "url"; url: string } =>
        s.sourceType === "url" && typeof (s as { url?: unknown }).url === "string",
    );
    const resolved = await Promise.all(
      urlSources.map(async (s) => ({
        title: s.title?.trim() ?? "",
        url: await resolveRedirect(s.url),
        description: "",
      })),
    );
    // Grounding can cite the same page more than once.
    const seen = new Set<string>();
    const unique = resolved.filter((r) => !seen.has(r.url) && seen.add(r.url));
    return unique.length > 0 ? unique : null;
  } catch {
    return null;
  }
}

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

export async function ahrefsSerpSearch(
  query: string,
  country: string,
): Promise<{ title: string; url: string; description: string }[] | null> {
  const token = process.env.AHREFS_API_TOKEN;
  if (!token) return null;
  const params = new URLSearchParams({
    keyword: query.slice(0, 200),
    country,
    date: yesterday(),
    select: "position,url,title",
  });
  try {
    const res = await fetch(
      `https://api.ahrefs.com/v3/serp-overview/serp-overview?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      positions?: { url: string | null; title: string | null }[];
    };
    const hits = (json.positions ?? [])
      // Null URLs are SERP features (People Also Ask, etc.); google.com links
      // are Google's own store/maps pages, not sources.
      .filter((p) => p.url && !/^https?:\/\/(www\.)?google\./.test(p.url))
      .map((p) => ({ title: p.title?.trim() ?? "", url: p.url!, description: "" }));
    return hits.length > 0 ? hits : null;
  } catch {
    return null;
  }
}

export async function webSearch(
  query: string,
  { country = "ph", limit = 5, maxCharsPerResult = 4000 } = {},
): Promise<WebSearchResponse | null> {
  const fallbacks: string[] = [];

  const firecrawl = await firecrawlSearch(query, limit, maxCharsPerResult);
  if (firecrawl && firecrawl.length > 0) {
    return { provider: "firecrawl", results: firecrawl, fallbacks };
  }
  fallbacks.push("firecrawl: unavailable (no key, out of credits, or no results)");

  const google = await googleGroundedSearch(query);
  if (google) {
    return {
      provider: "google",
      results: await hydrate(google, limit, maxCharsPerResult),
      fallbacks,
    };
  }
  fallbacks.push("google: grounding unavailable or returned no sources");

  const ahrefs = await ahrefsSerpSearch(query, country);
  if (ahrefs) {
    return {
      provider: "ahrefs",
      results: await hydrate(ahrefs, limit, maxCharsPerResult),
      fallbacks,
    };
  }
  console.error("webSearch: every provider failed", { query, fallbacks });
  return null;
}
