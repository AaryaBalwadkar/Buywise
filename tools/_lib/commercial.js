// BuyWise commercial evidence rules: candidate vs VERIFIED offer vs vendor.
// A PostgreSQL offer exists ONLY with product + merchant + numeric price + known
// currency + source URL. Anything less stays research evidence (never an offer).
// Pure functions (unit-testable with fixtures); canonical for agents + harness.

export function isPresent(v) {
  return v !== null && v !== undefined && !(typeof v === "string" && (v.trim() === "" || v.trim().toLowerCase() === "unavailable"));
}

// Price acceptance: numeric > 0, known ISO currency, clear product identity,
// identifiable merchant, real source URL. "Starting from", snippet inference,
// review/article mentions all rejected (callers must not pass those in).
export function validateOfferEvidence({ product_name, product_url, merchant_name, merchant_url, price, currency, source_url }) {
  const missing = [];
  if (!isPresent(product_name) || !isPresent(product_url)) missing.push("product identity unclear");
  if (!isPresent(merchant_name)) missing.push("merchant missing");
  if (!(typeof price === "number" && price > 0)) missing.push("price missing/malformed");
  if (!(typeof currency === "string" && /^[A-Z]{3}$/.test(currency))) missing.push("currency missing/ambiguous");
  if (!isPresent(source_url)) missing.push("source URL missing");
  else { try { new URL(source_url); } catch { missing.push("source URL malformed"); } }
  return { accepted: missing.length === 0, missing };
}

// Vendor acceptance: real merchant identity only. Placeholders rejected explicitly.
const PLACEHOLDER_VENDORS = ["vendor a", "vendor b", "vendor c", "test vendor", "unknown", "n/a", "tbd", "sample", "demo"];
export function validateVendorEvidence({ vendor_name, source_url, merchant_url, provider }) {
  const missing = [];
  const nm = typeof vendor_name === "string" ? vendor_name.trim() : "";
  if (!nm) missing.push("merchant missing");
  else if (PLACEHOLDER_VENDORS.includes(nm.toLowerCase())) missing.push("placeholder vendor rejected");
  if (!isPresent(source_url) && !isPresent(merchant_url)) missing.push("no source/merchant URL");
  if (!isPresent(provider)) missing.push("provider missing");
  return { accepted: missing.length === 0, missing };
}

// Stable product identity from evidence (never merge on similar names alone).
// Priority: SerpAPI product cluster id (same product across merchants) >
// direct (non-redirector) product URL > normalized brand+model.
// Redirector hosts (Google/Bing shopping redirects) must NEVER be URL identity:
// many products share one redirect base, so query-stripping would collapse them.
const REDIRECTOR_HOSTS = ["google.com", "bing.com", "yahoo.com", "shopping.google.com"];
export function isRedirector(url) {
  try { const h = new URL(url).hostname.toLowerCase(); return REDIRECTOR_HOSTS.some((r) => h === r || h.endsWith("." + r)); }
  catch { return false; }
}
export function productIdentity({ product_url, serpapi_product_id, brand, model, merchant_name }) {
  if (isPresent(serpapi_product_id) && serpapi_product_id !== "unavailable") return { kind: "serpapi_id", key: `serpapi:${serpapi_product_id}` };
  if (isPresent(product_url) && !isRedirector(product_url)) return { kind: "url", key: String(product_url).split("?")[0].toLowerCase() };
  if (isPresent(product_url) && isRedirector(product_url)) return { kind: "weak", key: null, note: "redirector-url" };
  const b = isPresent(brand) ? brand.trim().toLowerCase() : null;
  const m = isPresent(model) && model !== "unavailable" ? model.trim().toLowerCase() : null;
  if (b && m) return { kind: "brand_model", key: `${b}::${m}` };
  return { kind: "weak", key: null };
}

// Merchant dedup key: normalized name + registrable domain (don't collapse distinct sellers).
export function merchantKey({ merchant_name, merchant_url }) {
  const nm = (merchant_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  let dom = null;
  try { if (merchant_url) dom = new URL(merchant_url).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* ignore */ }
  if (!nm) return null;
  return `${nm}@@${dom ?? "no-domain"}`;
}

// Confidence from evidence completeness (matches adapter scale; documented).
export function evidenceConfidence(fields) {
  const filled = Object.values(fields || {}).filter(isPresent).length;
  return Math.min(0.5 + filled * 0.07, 0.9);
}

// Conservative deterministic duplicate grouping for derived views (never deletes
// rows — history and provenance stay intact). Two offers group together ONLY when
// merchant identity, price, currency AND product identity all match; the source
// URL is intentionally NOT part of the key because one SerpAPI cluster fans out
// to many Google redirect URLs for the same merchant+price (see reference case:
// 172 rows collapse to far fewer merchant x price groups).
// Distinct variants, sellers, prices, or products never merge.
// Returns [{ key, merchant, unit_price, currency, product_id, product_name,
// offer_ids, count, source_urls, data_status }].
export function groupOffers({ offers = [], vendorsById = {}, productsById = {} } = {}) {
  const groups = new Map();
  for (const o of offers) {
    const v = vendorsById[o.vendor_id] || {};
    const p = productsById[o.product_id] || {};
    const merch = String(v.vendor_name || o.vendor_id || 'unknown').trim().toLowerCase();
    const price = typeof o.net_price === 'number' ? o.net_price : (typeof o.unit_price === 'number' ? o.unit_price : null);
    const ccy = o.currency ? String(o.currency).toUpperCase() : 'UNKNOWN';
    const prod = String(o.product_id || 'unknown');
    const key = [merch, price === null ? 'no-price' : price.toFixed(2), ccy, prod].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        key, merchant: v.vendor_name || o.vendor_id, unit_price: price, currency: o.currency || null,
        product_id: o.product_id, product_name: p.name || o.product_id,
        offer_ids: [], count: 0, source_urls: [], data_status: o.data_status || null,
        vendor_id: o.vendor_id,
      });
    }
    const g = groups.get(key);
    g.offer_ids.push(o.offer_id);
    g.count += 1;
    if (o.source_url && !g.source_urls.includes(o.source_url)) g.source_urls.push(o.source_url);
  }
  return [...groups.values()].sort((a, b) =>
    (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity) ||
    String(a.merchant).localeCompare(String(b.merchant)));
}
