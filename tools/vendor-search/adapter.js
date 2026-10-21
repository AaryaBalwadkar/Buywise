// tools/vendor-search/adapter.js — REAL merchants for a verified product.
// Primary: SerpAPI Google Shopping (listings + per-product sellers = multi-merchant
// offers). Secondary: Tavily (enrichment evidence only — never prices/offers).
// eBay is INACTIVE unless EBAY_ENABLED=true (retained for audit history).
import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";
import { serpapiShoppingSearch, serpapiProductSellers } from "../product-search/serpapi-shopping.js";

export async function vendorSearch({ query, limit = 10, serpapi_product_id = null, productCtx = null, env = process.env } = {}) {
  if (!query?.trim() && !serpapi_product_id) return [unavailable("vendor-search", "query or serpapi_product_id required", { retryable: false })];
  const out = [];

  // 1. SerpAPI listings: each result carries merchant + price evidence where present.
  if (query?.trim()) {
    for (const e of await serpapiShoppingSearch({ query, limit, env })) {
      if (e.data_status === "UNAVAILABLE") { out.push(e); continue; }
      const d = e.data || {};
      out.push({
        ...e,
        data: {
          vendor_name: d.merchant_name ?? "unavailable",
          price: d.price ?? "unavailable", currency: d.currency ?? "unavailable",
          shipping: d.delivery ?? "unavailable", condition: "unavailable",
          product_name: d.product_name ?? "unavailable",
          product_url: d.product_url ?? "unavailable",
          serpapi_product_id: e._serpapi?.product_id ?? "unavailable",
          title: d.product_name ?? "unavailable",
        },
      });
    }
  }

  // 2. SerpAPI per-product sellers: separate real offers per merchant (no collapsing).
  const pid = serpapi_product_id || (out.find((e) => e.data?.serpapi_product_id && e.data.serpapi_product_id !== "unavailable")?.data?.serpapi_product_id);
  if (pid && pid !== "unavailable") {
    for (const e of await serpapiProductSellers({ serpapi_product_id: pid, productCtx, env })) out.push(e);
  }

  // 3. Tavily enrichment evidence (official sites, warranty/shipping pages). Never offers.
  const tavilyKey = requireEnv("TAVILY_API_KEY", env);
  if (tavilyKey && query?.trim()) {
    try {
      const r = await fetchJson("https://api.tavily.com/search", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
        body: JSON.stringify({ query: `${query} official website warranty shipping policy`, max_results: Math.min(limit, 10), search_depth: "basic" }),
      });
      if (r.ok) {
        for (const x of (r.json?.results ?? []).filter((y) => y?.url && !isExcludedUrl(y.url))) {
          out.push(envelope({ source: "tavily_search", source_url: x.url, confidence: 0.5, data: { title: x.title ?? "unavailable", snippet: (x.content ?? "").slice(0, 2000), vendor_name: "unavailable", price: "unavailable", currency: "unavailable", kind: "enrichment_evidence" } }));
        }
      }
    } catch { /* enrichment secondary: ignore */ }
  }

  // 4. eBay: INACTIVE unless explicitly enabled.
  const ebayEnabled = String(env.EBAY_ENABLED ?? process.env.EBAY_ENABLED ?? "false").toLowerCase() === "true";
  if (ebayEnabled) out.push(unavailable("ebay_browse_api", "eBay inactive in provider strategy; enable only as future option", { retryable: false }));

  const live = out.filter((e) => e.data_status !== "UNAVAILABLE");
  return live.length ? live : out.slice(0, 2);
}
