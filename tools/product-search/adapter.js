// tools/product-search/adapter.js — REAL product discovery.
// Primary structured: SerpAPI Google Shopping. Web research: Tavily Search.
// eBay is INACTIVE (NOT REQUIRED) unless EBAY_ENABLED=true with credentials;
// historical code retained so old audit records stay interpretable.
import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";
import { serpapiShoppingSearch } from "./serpapi-shopping.js";

async function ebayToken(appId, certId) {
  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/api_scope/browse",
  });
  if (!res.ok) throw new Error(`eBay OAuth HTTP ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("eBay OAuth: no access_token");
  return j.access_token;
}

export async function productSearch({ query, limit = 10, env = process.env } = {}) {
  if (!query?.trim()) return [unavailable("product-search", "empty query", { retryable: false })];
  const out = [];

  // Structured commercial listings first (SerpAPI Google Shopping).
  out.push(...await serpapiShoppingSearch({ query, limit, env }));
  const tavilyKey = requireEnv("TAVILY_API_KEY", env);
  const appId = requireEnv("EBAY_APP_ID", env);
  const certId = requireEnv("EBAY_CERT_ID", env);

  if (tavilyKey) {
    try {
      const r = await fetchJson("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
        body: JSON.stringify({ query: `${query} product specifications buy`, max_results: limit, search_depth: "advanced", include_answer: false }),
      }, 20000);
      if (r.ok) {
        for (const x of (r.json?.results ?? []).filter((y) => y?.url && !isExcludedUrl(y.url))) {
          out.push(envelope({ source: "tavily_search", source_url: x.url, confidence: 0.6, data: { title: x.title ?? "unavailable", snippet: x.content ?? "unavailable" } }));
        }
      } else out.push(unavailable("tavily_search", `HTTP ${r.status}`, { retryable: r.status >= 500 || r.status === 429 }));
    } catch (e) { out.push(unavailable("tavily_search", e.message, { retryable: true })); }
  } else out.push(unavailable("tavily_search", "Provider credentials not configured", { retryable: false }));

  // eBay: INACTIVE unless explicitly enabled (EBAY_ENABLED=true). Retained for audit history.
  const ebayEnabled = String(env.EBAY_ENABLED ?? process.env.EBAY_ENABLED ?? "false").toLowerCase() === "true";
  if (ebayEnabled && appId && certId) {
    try {
      const token = await ebayToken(appId, certId);
      const r = await fetchJson(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 50)}`, {
        headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      }, 20000);
      if (r.ok) {
        for (const it of (r.json?.itemSummaries ?? [])) {
          if (!it?.itemWebUrl || isExcludedUrl(it.itemWebUrl)) continue;
          out.push(envelope({
            source: "ebay_browse_api", source_url: it.itemWebUrl, confidence: 0.85,
            data: {
              title: it.title ?? "unavailable", itemId: it.itemId ?? "unavailable",
              price: it.price?.value ?? "unavailable", currency: it.price?.currency ?? "unavailable",
              condition: it.condition ?? "unavailable", seller: it.seller?.username ?? "unavailable",
            },
          }));
        }
      } else out.push(unavailable("ebay_browse_api", `HTTP ${r.status}`, { retryable: r.status >= 500 || r.status === 429 }));
    } catch (e) { out.push(unavailable("ebay_browse_api", e.message, { retryable: true })); }
  } else if (!ebayEnabled) { /* eBay inactive by provider strategy; silent */ }
  else out.push(unavailable("ebay_browse_api", "Provider credentials not configured", { retryable: false }));

  const live = out.filter((e) => e.data_status !== "UNAVAILABLE");
  return live.length ? live : out.slice(0, 3);
}
