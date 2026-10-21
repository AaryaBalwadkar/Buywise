// tools/product-search/serpapi-shopping.js — REAL SerpAPI Google Shopping adapter.
// Primary structured commercial source (replaces eBay, now inactive). Tavily remains
// for web research/evidence. Key ONLY from env (SERPAPI_API_KEY), never hardcoded,
// never logged. Pure normalize + error-mapping functions are exported for unit tests
// (fixtures only, never production data).

import { envelope, unavailable, fetchJson, requireEnv, isExcludedUrl } from "../_lib/envelope.js";

const SEARCH_URL = "https://serpapi.com/search.json";
const PRODUCT_URL = "https://serpapi.com/search.json";

// Locale: Indian market by default (gl=in, hl=en), overridable via env
// (SERPAPI_GL, SERPAPI_HL, SERPAPI_LOCATION). No other provider affected.
function localeParams(env = process.env) {
  const gl = (env.SERPAPI_GL || process.env.SERPAPI_GL || "in").trim().toLowerCase();
  const hl = (env.SERPAPI_HL || process.env.SERPAPI_HL || "en").trim().toLowerCase();
  const loc = (env.SERPAPI_LOCATION || process.env.SERPAPI_LOCATION || "").trim();
  return { gl, hl, loc };
}

// Currency deterministically established ONLY from explicit symbols/codes in the
// source payload. No symbol/code -> currency unknown (never guessed, never converted).
const SYMBOL_CCY = new Map([["₹", "INR"], ["Rs.", "INR"], ["Rs", "INR"], ["$", "USD"], ["US$", "USD"], ["€", "EUR"], ["£", "GBP"], ["¥", "JPY"], ["C$", "CAD"], ["A$", "AUD"]]);

export function parsePrice(rawPrice, rawCurrency = null) {
  if (rawPrice === null || rawPrice === undefined) return { price: null, currency: null };
  if (typeof rawPrice === "number") {
    const ccy = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.trim().toUpperCase()) ? rawCurrency.trim().toUpperCase() : null;
    return { price: rawPrice > 0 ? rawPrice : null, currency: rawPrice > 0 ? ccy : null };
  }
  if (typeof rawPrice !== "string") return { price: null, currency: null };
  const s = rawPrice.trim();
  if (/starting from/i.test(s)) return { price: null, currency: null, note: "range-price-not-exact" };
  let currency = null;
  for (const [sym, ccy] of SYMBOL_CCY) if (s.includes(sym)) { currency = ccy; break; }
  const codeMatch = s.match(/\b(INR|USD|EUR|GBP|JPY|CAD|AUD)\b/i);
  if (codeMatch) currency = codeMatch[1].toUpperCase();
  const numMatch = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  const num = numMatch ? Number(numMatch[1]) : null;
  if (num === null || !(num > 0)) return { price: null, currency: null };
  return { price: num, currency };
}

// HTTP mapping: 401/403 = credential problem (no retry); 429/5xx/timeout = retryable.
export function mapHttpError(status, message) {
  if (status === 401 || status === 403) return { retryable: false, error: `SerpAPI HTTP ${status} (credential/forbidden): ${message}` };
  if (status === 429) return { retryable: true, error: `SerpAPI HTTP 429 rate-limited: ${message}` };
  if (status >= 500) return { retryable: true, error: `SerpAPI HTTP ${status}: ${message}` };
  return { retryable: false, error: `SerpAPI HTTP ${status}: ${message}` };
}

// Normalize ONE shopping_results[] item. Only fields SerpAPI actually returned.
// Confidence reflects evidence completeness, never fabricated.
export function normalizeShoppingItem(it, retrieved_at) {
  if (!it || typeof it !== "object") return null;
  const link = it.link || it.product_link || null;
  if (!link || isExcludedUrl(link)) return null;
  const source_url = String(link).replace(/ /g, "%20");
  const { price, currency } = parsePrice(it.price ?? it.extracted_price ?? null);
  const rating = typeof it.rating === "number" && it.rating >= 0 && it.rating <= 5 ? it.rating : null;
  const reviews = Number.isInteger(it.reviews) && it.reviews >= 0 ? it.reviews : null;
  const merchant = typeof it.source === "string" && it.source.trim() ? it.source.trim() : null;
  const data = {
    product_name: it.title ?? "unavailable",
    brand: "unavailable",
    model: it.product_id ?? "unavailable",
    merchant_name: merchant ?? "unavailable",
    merchant_url: "unavailable",
    product_url: link,
    price: price ?? "unavailable",
    currency: currency ?? "unavailable",
    delivery: it.delivery ?? "unavailable",
    rating: rating ?? "unavailable",
    review_count: reviews ?? "unavailable",
  };
  const filled = ["product_name", "merchant_name", "price", "currency", "rating", "review_count", "delivery"].filter((k) => data[k] !== "unavailable").length;
  const commercialCore = merchant !== null && price !== null && currency !== null;
  return {
    source: "serpapi_shopping", source_url, retrieved_at,
    data_status: commercialCore && filled >= 4 ? "LIVE" : "PARTIAL",
    confidence: Math.min(0.5 + filled * 0.07, 0.9),
    data, error: null, retryable: false,
    _serpapi: { product_id: it.product_id ?? null, thumbnail: it.thumbnail ?? null },
  };
}

// Normalize ONE sellers[] entry from the product endpoint into offer-grade evidence.
export function normalizeSeller(s, productCtx, retrieved_at) {
  if (!s || typeof s !== "object") return null;
  const link = s.link || null;
  if (!link || isExcludedUrl(link)) return null;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : null;
  if (!name) return null;
  const { price, currency } = parsePrice(s.total_price ?? s.price ?? null);
  const source_url = String(link).replace(/ /g, "%20");
  return {
    source: "serpapi_shopping", source_url, retrieved_at,
    data_status: price !== null && currency !== null ? "LIVE" : "PARTIAL",
    confidence: price !== null && currency !== null ? 0.85 : 0.5,
    data: {
      merchant_name: name, merchant_url: link, product_url: productCtx?.product_url ?? "unavailable",
      product_name: productCtx?.product_name ?? "unavailable",
      price: price ?? "unavailable", currency: currency ?? "unavailable",
      delivery: s.shipping ?? s.delivery ?? "unavailable",
    },
    error: null, retryable: false,
  };
}

export async function serpapiShoppingSearch({ query, limit = 10, env = process.env } = {}) {
  if (!query?.trim()) return [unavailable("serpapi_shopping", "empty query", { retryable: false })];
  const key = requireEnv("SERPAPI_API_KEY", env);
  if (!key) return [unavailable("serpapi_shopping", "Provider credentials not configured", { retryable: false })];
  const { gl, hl, loc } = localeParams(env);
  const now = new Date().toISOString();
  let r;
  try {
    r = await fetchJson(`${SEARCH_URL}?engine=google_shopping&q=${encodeURIComponent(query)}&num=${Math.min(limit, 20)}&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}${loc ? `&location=${encodeURIComponent(loc)}` : ""}&api_key=${encodeURIComponent(key)}`, {}, 20000);
  } catch (e) {
    return [unavailable("serpapi_shopping", `request failed: ${e.message}`, { retryable: true })];
  }
  if (!r.ok) {
    const m = mapHttpError(r.status, r.json?.error ?? "request failed");
    return [unavailable("serpapi_shopping", m.error, { retryable: m.retryable })];
  }
  const items = Array.isArray(r.json?.shopping_results) ? r.json.shopping_results : [];
  if (!items.length) return [unavailable("serpapi_shopping", "empty result set", { retryable: false })];
  const out = items.map((it) => normalizeShoppingItem(it, now)).filter(Boolean);
  return out.length ? out : [unavailable("serpapi_shopping", "no verifiable (non-excluded) results", { retryable: false })];
}

export async function serpapiProductSellers({ serpapi_product_id, productCtx = null, env = process.env } = {}) {
  if (!serpapi_product_id) return [unavailable("serpapi_shopping", "serpapi product_id required", { retryable: false })];
  const key = requireEnv("SERPAPI_API_KEY", env);
  if (!key) return [unavailable("serpapi_shopping", "Provider credentials not configured", { retryable: false })];
  const { gl, hl, loc } = localeParams(env);
  const now = new Date().toISOString();
  let r;
  try {
    r = await fetchJson(`${PRODUCT_URL}?engine=google_shopping_product&product_id=${encodeURIComponent(serpapi_product_id)}&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}${loc ? `&location=${encodeURIComponent(loc)}` : ""}&api_key=${encodeURIComponent(key)}`, {}, 20000);
  } catch (e) {
    return [unavailable("serpapi_shopping", `request failed: ${e.message}`, { retryable: true })];
  }
  if (!r.ok) {
    const m = mapHttpError(r.status, r.json?.error ?? "request failed");
    return [unavailable("serpapi_shopping", m.error, { retryable: m.retryable })];
  }
  const sellers = Array.isArray(r.json?.sellers) ? r.json.sellers : [];
  if (!sellers.length) return [unavailable("serpapi_shopping", "no sellers returned", { retryable: false })];
  const out = sellers.map((s) => normalizeSeller(s, productCtx, now)).filter(Boolean);
  return out.length ? out : [unavailable("serpapi_shopping", "no verifiable sellers", { retryable: false })];
}
