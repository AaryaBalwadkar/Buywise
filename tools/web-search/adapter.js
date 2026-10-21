// tools/web-search/adapter.js — REAL web search via Tavily (primary), SerpAPI organic (optional fallback).
// Never fabricates results. Missing credentials -> UNAVAILABLE (retryable:false).
// Filters out Amazon/Flipkart hosts per Phase 1 exclusion.
import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";

export async function webSearch({ query, max_results = 8, env = process.env } = {}) {
  if (!query || !String(query).trim()) return [unavailable("web-search", "empty query", { retryable: false })];
  const tavilyKey = requireEnv("TAVILY_API_KEY", env);
  const serpKey = requireEnv("SERPAPI_API_KEY", env);
  if (!tavilyKey && !serpKey) {
    return [unavailable("web-search", "Provider credentials not configured (TAVILY_API_KEY, SERPAPI_API_KEY)", { retryable: false })];
  }
  // Primary: Tavily
  if (tavilyKey) {
    try {
      const r = await fetchJson("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
        body: JSON.stringify({ query, max_results: Math.min(max_results, 20), search_depth: "basic", include_answer: false }),
      });
      if (!r.ok) {
        if (!serpKey) return [unavailable("tavily_search", `HTTP ${r.status}`, { retryable: r.status >= 500 || r.status === 429 })];
      } else {
        const results = (r.json?.results ?? []).filter((x) => x?.url && !isExcludedUrl(x.url));
        if (!results.length) return [unavailable("tavily_search", "No verifiable (non-excluded) results", { retryable: false })];
        return results.map((x) =>
          envelope({ source: "tavily_search", source_url: x.url, confidence: 0.65, data: { title: x.title ?? "unavailable", snippet: x.content ?? "unavailable" } })
        );
      }
    } catch (e) { if (!serpKey) return [unavailable("tavily_search", e.message, { retryable: true })]; }
  }
  // Optional fallback: SerpAPI organic (never mandatory)
  try {
    const r = await fetchJson(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${max_results}&api_key=${serpKey}`);
    if (!r.ok) return [unavailable("serpapi_organic", `HTTP ${r.status}`, { retryable: r.status >= 500 || r.status === 429 })];
    const results = (r.json?.organic_results ?? []).filter((x) => x?.link && !isExcludedUrl(x.link));
    if (!results.length) return [unavailable("serpapi_organic", "No verifiable (non-excluded) results", { retryable: false })];
    return results.map((x) =>
      envelope({ source: "serpapi_organic", source_url: x.link, confidence: 0.55, data: { title: x.title ?? "unavailable", snippet: x.snippet ?? "unavailable" } })
    );
  } catch (e) { return [unavailable("serpapi_organic", e.message, { retryable: true })]; }
}
