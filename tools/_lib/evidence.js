// BuyWise deterministic evidence helpers. NO LLM. Missing stays missing.
// A field counts as verified ONLY when present and !== "unavailable" (case-insensitive).

export const DEFAULT_SPEC_FIELDS = ["processor", "ram", "storage", "operating_system", "display", "battery", "graphics"];

export function isVerified(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim().toLowerCase() === "unavailable") return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

// completeness = verified_fields / total_fields. 0.5 means half the defined fields had
// evidence — NOT "50% good". Empty field list -> 0 (no basis), never NaN.
export function specCompleteness(specifications, fields = DEFAULT_SPEC_FIELDS) {
  if (!Array.isArray(fields) || fields.length === 0) return { completeness: 0, verified: 0, total: 0 };
  const specs = specifications && typeof specifications === "object" ? specifications : {};
  const lower = Object.fromEntries(Object.entries(specs).map(([k, v]) => [k.toLowerCase(), v]));
  let verified = 0;
  for (const f of fields) if (isVerified(lower[String(f).toLowerCase()])) verified++;
  return { completeness: verified / fields.length, verified, total: fields.length };
}

// Strict rating extraction from REAL snippet text. Returns null unless an explicit
// numeric rating with an explicit scale is present. Never guesses the scale.
export function extractRating(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/,/g, "");
  let m = t.match(/(\d(?:\.\d+)?)\s*\/\s*5(?!\d)/);
  if (m && Number(m[1]) >= 0 && Number(m[1]) <= 5) return { rating: Number(m[1]), scale: 5, basis: `${m[1]}/5` };
  m = t.match(/(\d(?:\.\d+)?)\s+out of\s+5(?!\d)/i);
  if (m && Number(m[1]) >= 0 && Number(m[1]) <= 5) return { rating: Number(m[1]), scale: 5, basis: `${m[1]} out of 5` };
  m = t.match(/(\d(?:\.\d+)?)\s*stars?/i);
  if (m && Number(m[1]) >= 0 && Number(m[1]) <= 5) return { rating: Number(m[1]), scale: 5, basis: `${m[1]} stars (5-scale convention, documented)` };
  return null;
}

// Strict spec extraction from REAL extracted page text. A spec value is accepted
// ONLY when exactly ONE distinct numeric value matches for that spec on the page
// (multiple distinct values = ambiguous list page -> null). No inference:
// "16GB" alone (no RAM/storage context) never counts. TB converted to GB (x1024).
export function extractSpecs(text) {
  const out = { ram_gb: null, storage_gb: null, warranty_months: null, _rejected: [] };
  if (!text || typeof text !== "string") return out;
  const t = text.replace(/,/g, "");
  const uniq = (arr) => [...new Set(arr)];
  const ramHits = uniq([
    ...t.matchAll(/(\d+)\s*GB\s*(?:DDR[345]?\s*)?RAM/gi),
    ...t.matchAll(/RAM\s*[:\-–]\s*(\d+)\s*GB/gi),
    ...t.matchAll(/Memory\s*[:\-]\s*(\d+)\s*GB/gi),
  ].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 512));
  if (ramHits.length === 1) out.ram_gb = { value: ramHits[0], basis: `${ramHits[0]}GB RAM (explicit)` };
  else if (ramHits.length > 1) out._rejected.push(`ram-ambiguous:${ramHits.join("/")}`);
  const storGB = [
    ...t.matchAll(/(\d+)\s*GB\s*(?:SSD|NVMe|storage)/gi),
    ...t.matchAll(/SSD\D{0,25}(\d+)\s*GB/gi),
  ].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 16384);
  const storTB = [
    ...t.matchAll(/(?:storage|SSD)\D{0,30}(\d+)\s*TB/gi),
    ...t.matchAll(/(\d+)\s*TB\s*(?:SSD|storage|HDD|NVMe)/gi),
  ].map((m) => Number(m[1]) * 1024).filter((n) => n > 0 && n <= 16384);
  const storHits = uniq([...storGB, ...storTB]);
  if (storHits.length === 1) out.storage_gb = { value: storHits[0], basis: `${storHits[0]}GB storage (explicit)` };
  else if (storHits.length > 1) out._rejected.push(`storage-ambiguous:${storHits.join("/")}`);
  const warHits = uniq([...t.matchAll(/(\d+)\s*[- ]?year\D{0,15}warranty/gi)].map((m) => Number(m[1]) * 12).filter((n) => n > 0 && n <= 120));
  if (warHits.length === 1) out.warranty_months = { value: warHits[0], basis: `${warHits[0] / 12}-year warranty (explicit)` };
  else if (warHits.length > 1) out._rejected.push(`warranty-ambiguous:${warHits.join("/")}`);
  return out;
}

// Same-party guard: a contact address counts as a vendor channel ONLY when the
// contact page host contains the merchant's own name token (e.g. dell.com for Dell).
// Third-party directories (elliott.org, etc.) are real evidence but NOT the vendor's
// own channel. Never infer the merchant domain — match on the name itself.
export function contactHostMatches(merchantName, sourceUrl) {
  if (!merchantName || !sourceUrl) return false;
  const tokens = String(merchantName).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  if (!tokens.length) return false;
  let host = "";
  try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { return false; }
  return tokens.some((t) => host.includes(t));
}
// text from a URL containing 'contact'). Excludes role/abuse addresses. First match
// wins; returns null otherwise. Never invent, never infer from domains.
const EMAIL_BLOCK = ["noreply", "no-reply", "donotreply", "abuse", "postmaster", "mailer-daemon", "privacy", "legal", "unsubscribe"];
export function extractContactEmail(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const e of m) {
    const local = e.split("@")[0].toLowerCase();
    if (EMAIL_BLOCK.some((b) => local.includes(b))) continue;
    if (e.length > 254 || /\.\.|@@/.test(e)) continue;
    return { email: e, basis: "explicit address on contact page" };
  }
  return null;
}
// snippet (a) contains product-context tokens AND (b) carries exactly ONE rating
// pattern (multiple patterns = ambiguous subject, e.g. list pages showing many models'
// ratings). Otherwise the evidence is real but NOT attributable -> null.
export function countRatingPatterns(text) {
  if (!text || typeof text !== "string") return 0;
  const t = text.replace(/,/g, "");
  const pats = [
    /\d(?:\.\d+)?\s*\/\s*5(?!\d)/g,
    /\d(?:\.\d+)?\s+out of\s+5(?!\d)/gi,
    /\d(?:\.\d+)?\s*stars?/gi,
  ];
  return pats.reduce((n, re) => n + (t.match(re) || []).length, 0);
}

export function containsToken(text, tokens) {
  if (!text || !Array.isArray(tokens) || !tokens.length) return false;
  const t = text.toLowerCase();
  return tokens.some((tok) => tok && t.includes(String(tok).toLowerCase()));
}

// Returns { rating, scale, basis, context } or null. Context = ~200 chars around the
// match so the basis stays visible in stored evidence.
export function extractAttributableRating(text, relevanceTokens = []) {
  const r = extractRating(text);
  if (!r) return null;
  if (!containsToken(text, relevanceTokens)) return { rejected: "no-product-context" };
  if (countRatingPatterns(text) !== 1) return { rejected: "ambiguous-multiple-ratings" };
  const idx = text.indexOf(r.basis.split(" ")[0]);
  const context = idx >= 0 ? text.slice(Math.max(0, idx - 120), idx + 200) : text.slice(0, 320);
  return { ...r, context };
}

// Strict review-count extraction. Returns null unless explicit. Counts are accepted
// only alongside an attributable rating (same snippet), enforced by the caller.
export function extractReviewCount(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.replace(/,/g, "").match(/(\d+)\s+(?:reviews?|ratings?|user reviews?)/i);
  if (m && Number(m[1]) >= 0) return { count: Number(m[1]), basis: m[0] };
  return null;
}
