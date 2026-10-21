// BuyWise Tool Gateway shared helpers (real-data only, no mocks).
// Used by each adapter under tools/*/adapter.js and mirrored by n8n workflow 92-util-tool-gateway.

export const DATA_STATUS = ["LIVE", "PARTIAL", "STALE", "UNAVAILABLE"];

// Phase 1 exclusion: never present Amazon/Flipkart as verified procurement offers.
const EXCLUDED_HOSTS = ["amazon.", "flipkart."];
export function isExcludedUrl(url = "") {
  const u = String(url).toLowerCase();
  return EXCLUDED_HOSTS.some((h) => u.includes(h));
}

export function unavailable(source, error, extra = {}) {
  return {
    source,
    source_url: null,
    retrieved_at: new Date().toISOString(),
    data_status: "UNAVAILABLE",
    confidence: 0,
    data: null,
    error: String(error),
    retryable: extra.retryable ?? true,
  };
}

export function envelope({ source, source_url, data, confidence = 0.7, retrieved_at, error = null, retryable = false }) {
  const hasNulls = data && typeof data === "object" && Object.values(data).some((v) => v === "unavailable");
  return {
    source,
    source_url,
    retrieved_at: retrieved_at ?? new Date().toISOString(),
    data_status: error ? "UNAVAILABLE" : hasNulls ? "PARTIAL" : "LIVE",
    confidence,
    data,
    error,
    retryable,
  };
}

export async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 2000) }; }
    return { ok: res.ok, status: res.status, json };
  } finally { clearTimeout(t); }
}

export function requireEnv(name, env = process.env) {
  const v = (env[name] ?? "").trim();
  return v ? v : null;
}
