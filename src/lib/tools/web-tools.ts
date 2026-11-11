import { tool } from "ai";
import { z } from "zod";
import { checkUrlStatus, scrapeMarkdown, type UrlStatus } from "@/lib/fetch-page";
import { webSearch } from "@/lib/web-search";

/**
 * Generic web tools available to every agent chat. `fetchWebPage` opens a URL
 * the user provides; `searchWeb` finds pages nobody handed us a link to —
 * without them, the agent can only reach our own connected data sources.
 *
 * Both are deliberately here rather than in a brand-scoped factory: they need no
 * integration connection, so they are merged unconditionally in
 * buildBrainTools() and reach every chat and task.
 */
export function webTools() {
  return {
    fetchWebPage: tool({
      description:
        "Fetch the readable content of a public web page and return it as markdown. Use this to read a URL the user pastes — competitor pages, articles, product pages, docs. Handles JavaScript-rendered and bot-protected (Cloudflare) sites. Returns up to ~12,000 characters. Call once per URL.",
      inputSchema: z.object({
        url: z
          .string()
          .describe("The full URL to fetch, including the https:// scheme."),
      }),
      execute: async ({ url }) => {
        try {
          const content = await scrapeMarkdown(url);
          if (!content) {
            return {
              error: `Could not fetch ${url} — it may be blocked, empty, or unreachable.`,
            };
          }
          return { url, content };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    searchWeb: tool({
      description:
        "Search the web. Returns up to 5 results, each with the page's own content when it could be read (a result without `content` was NOT read: do not describe it). Use this to find a source for something you would otherwise have to guess, or to reach pages nobody gave you a link to. One specific query beats several vague ones — include full names, titles and years. `provider` says which search backend answered.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "The search query, phrased as you would type it into a search engine.",
          ),
        country: z
          .string()
          .length(2)
          .optional()
          .describe(
            "Two-letter market for local results (ph, sg, th, vn). Defaults to ph.",
          ),
      }),
      execute: async ({ query, country }) => {
        try {
          const found = await webSearch(query, { country: country?.toLowerCase() });
          if (!found) {
            return {
              error: `Every search backend failed for "${query}" (Firecrawl, Google grounding, Ahrefs SERP). Do not answer from memory: treat anything this search would have confirmed as unverified and say so.`,
            };
          }
          return { query, provider: found.provider, results: found.results };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    checkUrls: tool({
      description:
        "Check what URLs actually return: HTTP status, final URL after redirects, and content type, as a real visitor would see it (a Cloudflare bot check is passed with a headless browser, never reported as the page being down). Use this BEFORE calling any page, sitemap or feed broken, for site health checks, and to confirm a redirect target. Up to 25 URLs per call. A result with status null and a note is a tool failure, not evidence the page is down.",
      inputSchema: z.object({
        urls: z
          .array(z.string())
          .min(1)
          .max(25)
          .describe("Full URLs including https://."),
      }),
      execute: async ({ urls }) => {
        const out: UrlStatus[] = [];
        // Five at a time: each may need a browser context, and a whole
        // sitemap's worth at once would exhaust the function's memory.
        for (let i = 0; i < urls.length; i += 5) {
          out.push(...(await Promise.all(urls.slice(i, i + 5).map((u) => checkUrlStatus(u)))));
        }
        return { results: out };
      },
    }),
  };
}
