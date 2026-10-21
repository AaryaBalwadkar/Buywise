// tools/price-retrieval/adapter.js — REAL time-sensitive prices only.
// Primary: SerpAPI Google Shopping (listing prices + per-product seller prices).
// eBay is INACTIVE unless EBAY_ENABLED=true. No FX conversion here.
import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";
import { serpapiShoppingSearch, serpapiProductSellers } from "../product-search/serpapi-shopping.js";

export async function priceRetrieval({ serpapi_product_id = null, query = null, productCtx = null, env = process.env } = {}) {
  const key = requireEnv("SERPAPI_API_KEY", env);
  if (!key && !serpapi_product_id && !query) {
    return [unavailable("price-retrieval", "serpapi_product_id or query required", { retryable: false })];
  }
  const out = [];
  if (serpapi_product_id) {
    for (const e of await serpapiProductSellers({ serpapi_product_id, productCtx, env })) {
      if (e.data_status === "UNAVAILABLE") { out.push(e); continue; }
      const d = e.data || {};
      out.push({
        ...e,
        data: {
          price: d.price ?? "unavailable", currency: d.currency ?? "unavailable",
          merchant: d.merchant_name ?? "unavailable",
          price_status: d.price !== "unavailable" && d.currency !== "unavailable" ? "LIVE" : "UNAVAILABLE",
        },
      });
    }
  } else if (query) {
    for (const e of await serpapiShoppingSearch({ query, limit: 10, env })) {
      if (e.data_status === "UNAVAILABLE") { out.push(e); continue; }
      const d = e.data || {};
      out.push({
        ...e,
        data: {
          price: d.price ?? "unavailable", currency: d.currency ?? "unavailable",
          merchant: d.merchant_name ?? "unavailable",
          price_status: d.price !== "unavailable" && d.currency !== "unavailable" ? "LIVE" : "UNAVAILABLE",
        },
      });
    }
  } else {
    return [unavailable("price-retrieval", "serpapi_product_id or query required", { retryable: false })];
  }
  return out.length ? out : [unavailable("price-retrieval", "No verifiable prices returned", { retryable: false })];
}
