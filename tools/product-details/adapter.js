// tools/product-details/adapter.js — REAL details for a verified URL.
// Tavily Extract for official pages + SerpAPI product data where available.
// eBay getItem active ONLY when EBAY_ENABLED=true (NOT REQUIRED otherwise). No guessing.
import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";

export async function productDetails({ url, ebayItemId = null, env = process.env } = {}) {
  if (!url && !ebayItemId) return unavailable("product-details", "url or ebayItemId required", { retryable: false });
  if (url && isExcludedUrl(url)) return unavailable("product-details", "Excluded source (Amazon/Flipkart) in Phase 1", { retryable: false });
  const tavilyKey = requireEnv("TAVILY_API_KEY", env);
  const ebayEnabled = String(env.EBAY_ENABLED ?? process.env.EBAY_ENABLED ?? "false").toLowerCase() === "true";
  const appId = requireEnv("EBAY_APP_ID", env);
  const certId = requireEnv("EBAY_CERT_ID", env);

  if (ebayItemId && ebayEnabled && appId && certId) {
    try {
      const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
      const t = await (await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
        body: "grant_type=client_credentials&scope=https://api.ebay.com/api_scope/browse",
      })).json();
      if (t.access_token) {
        const r = await fetchJson(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(ebayItemId)}`, {
          headers: { Authorization: `Bearer ${t.access_token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
        });
        if (r.ok && r.json?.itemWebUrl && !isExcludedUrl(r.json.itemWebUrl)) {
          return envelope({
            source: "ebay_browse_api", source_url: r.json.itemWebUrl, confidence: 0.9,
            data: {
              title: r.json.title ?? "unavailable", condition: r.json.condition ?? "unavailable",
              price: r.json.price?.value ?? "unavailable", currency: r.json.price?.currency ?? "unavailable",
              seller: r.json.seller?.username ?? "unavailable", shipping: r.json.shippingOptions ?? "unavailable",
              returnPolicy: r.json.returnTerms ?? "unavailable",
            },
          });
        }
      }
    } catch (e) { return unavailable("ebay_browse_api", e.message, { retryable: true }); }
  }
  if (tavilyKey && url) {
    try {
      const r = await fetchJson("https://api.tavily.com/extract", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
        body: JSON.stringify({ urls: [url], query: "specifications warranty delivery payment terms price", extract_depth: "basic" }),
      }, 25000);
      if (!r.ok) return unavailable("tavily_extract", `HTTP ${r.status}`, { retryable: r.status >= 500 || r.status === 429 });
      const item = (r.json?.results ?? [])[0];
      if (!item?.raw_content && !item?.content) return unavailable("tavily_extract", "No extractable content", { retryable: false });
      return envelope({
        source: "tavily_extract", source_url: url, confidence: 0.7,
        data: { title: "unavailable", extracted_text: (item.raw_content ?? item.content ?? "").slice(0, 8000) },
      });
    } catch (e) { return unavailable("tavily_extract", e.message, { retryable: true }); }
  }
  return unavailable("product-details", "Provider credentials not configured", { retryable: false });
}
