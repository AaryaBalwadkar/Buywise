// BuyWise deterministic re-evaluation. Reuses tools/_lib/scoring.js score() —
// NO duplicated scoring logic. Compares a verified original offer against a VERIFIED
// vendor response (email/API/portal). Without a real response: WAITING_FOR_VENDOR,
// no rows, no transition. Savings need two real same-currency prices, else null.
import { score, SCORING_RULES_VERSION } from "./scoring.js";

const num = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : null);

// Strict vendor-response validation. Every failure rejects loudly (never partial-accept).
// DEMO responses (channel 'demo' + response_mode DEMO_HUMAN_ENTERED + explicit mode)
// are accepted ONLY as demo input, labeled throughout; REAL validation is untouched.
export function validateResponse({ negotiation, offer, vendor, product, response, mode = "REAL" }) {
  const bad = [];
  if (!negotiation?.negotiation_id) bad.push("no negotiation reference");
  if (!offer?.offer_id) bad.push("offer identity unverifiable");
  if (!vendor?.vendor_id || !vendor?.vendor_name || vendor.vendor_name === "unavailable") bad.push("vendor identity unverifiable");
  if (!product?.product_id) bad.push("product identity unverifiable");
  if (response?.vendor_id && response.vendor_id !== vendor?.vendor_id) bad.push("response vendor mismatch");
  if (response?.offer_id && response.offer_id !== offer?.offer_id) bad.push("response offer mismatch");
  const rp = num(response?.revised_price);
  if (rp === null || rp <= 0) bad.push("malformed revised price");
  if (!response?.currency) bad.push("revised currency missing");
  if (!response?.received_at) bad.push("response timestamp missing");
  if (!response?.source) bad.push("evidence source missing");
  if (!response?.source_url && mode !== "DEMO") bad.push("evidence source URL missing");
  const demoOk = mode === "DEMO" && response?.channel === "demo" && response?.response_mode === "DEMO_HUMAN_ENTERED" && response?.vendor_response_verified === false;
  if (mode === "DEMO" && !demoOk && response?.channel === "demo") bad.push("demo response mislabeled (must be DEMO_HUMAN_ENTERED, unverified)");
  if (!["email", "vendor_api", "vendor_portal"].includes(response?.channel) && !demoOk) bad.push("untraceable response channel");
  if (mode !== "DEMO" && response?.channel === "demo") bad.push("demo response in REAL mode");
  return { valid: bad.length === 0, reasons: bad, demo: demoOk === true };
}

// original: { components, weights, price, currency } from the persisted comparison+offer.
// response: validated vendor response (revised commercial facts only).
// ctx: { negotiation, offer, vendor, product, response } identity context for validation.
// mode: 'REAL' default; 'DEMO' only with labeled human-entered demo responses.
export function reevaluate({ original, response, weights, ctx, mode = "REAL" }) {
  const vr = validateResponse({ ...(ctx || {}), response, mode });
  if (!vr.valid) return { status: "REJECTED", reasons: vr.reasons };
  const before = score(original.components, weights);
  const revisedComponents = { ...(original.components || {}) };
  // Only price-driven criteria may change: recompute from the verified revised price.
  const ccyOk = response.currency && original.currency && String(response.currency).toUpperCase() === String(original.currency).toUpperCase();
  if (num(response.revised_price) !== null && ccyOk && typeof original.budget === "number" && original.budget > 0) {
    revisedComponents.budget_compliance = response.revised_price <= original.budget ? 1 : 0;
  } else if (!ccyOk) {
    revisedComponents.budget_compliance = null;
  }
  const after = score(revisedComponents, weights);
  const changed = Object.keys(after.breakdown || {}).filter((k) => JSON.stringify((before.breakdown || {})[k]) !== JSON.stringify(after.breakdown[k]));
  let absolute_savings = null, percentage_savings = null;
  const op = num(original.price), rp = num(response.revised_price);
  if (op !== null && op > 0 && rp !== null && rp > 0 && ccyOk) {
    absolute_savings = Math.round((op - rp) * 100) / 100;
    percentage_savings = Math.round((op - rp) / op * 10000) / 100;
  }
  return {
    status: "REEVALUATED",
    original_score: before.overall_score, revised_score: after.overall_score,
    score_delta: before.overall_score === null || after.overall_score === null ? null : Math.round((after.overall_score - before.overall_score) * 10000) / 10000,
    original_price: op, revised_price: rp,
    currency: original.currency ?? response.currency ?? null,
    absolute_savings, percentage_savings,
    criteria_changed: changed, criteria_used: after.criteria_used, criteria_missing: after.criteria_missing,
    revised_components: revisedComponents,
    scoring_rules_version: SCORING_RULES_VERSION,
    // Provenance: every contributing criterion states its source, normalized
    // value, weight, normalization method, and contribution. A revised score of
    // 1.0 from a single criterion is mathematically valid but thin — callers
    // must surface criteria_used.length, not just the number.
    score_provenance: Object.fromEntries(
      (after.criteria_used || []).map((k) => [k, {
        source: k === "budget_compliance" ? "revised_price_vs_budget" : "original_evidence",
        normalized_value: after.breakdown?.[k]?.score ?? null,
        weight: after.breakdown?.[k]?.weight ?? weights?.[k] ?? null,
        method: k === "budget_compliance" ? "boolean_in_budget" : "engine_v1_carryover",
        contribution: after.breakdown?.[k]?.contribution ?? null,
      }])),
  };
}

// Gate: may reevaluate only with a real negotiation AND a real response object.
// DEMO: same gate, except the response may be a labeled human-entered demo response.
export function mayReevaluate({ negotiation, response, mode = "REAL" }) {
  if (!negotiation?.negotiation_id) return { ok: false, status: "NOT_ELIGIBLE", reason: "no negotiation exists" };
  const isDemo = mode === "DEMO" && response?.channel === "demo" && response?.response_mode === "DEMO_HUMAN_ENTERED" && response?.revised_price !== undefined && response?.revised_price !== null;
  if ((!response || typeof response !== "object" || !response.revised_price) && !isDemo) {
    return { ok: false, status: "WAITING_FOR_VENDOR", reason: "no verified vendor response" };
  }
  if (mode !== "DEMO" && response?.channel === "demo") {
    return { ok: false, status: "REJECTED", reason: "demo response in REAL mode" };
  }
  return { ok: true, status: "READY", demo: isDemo === true };
}
