// BuyWise DETERMINISTIC scoring engine (canonical implementation).
// The n8n workflow 60-util-scoring-engine embeds this same algorithm in a Code node
// (n8n Code nodes cannot import repo files); keep them in sync — tests pin the behavior.
// NEVER treats "unavailable" as 0: missing criteria are EXCLUDED and weights renormalized.
// A score of null means "no basis", not "bad".

// Rules version: bump ONLY if weights, criteria, normalizers, or ranking change.
// Persisted on scoring_configs + comparisons rows so any stored score is reproducible.
export const SCORING_RULES_VERSION = "1.0.0";

export const CRITERIA = [
  "price", "quality", "reviews", "delivery", "warranty",
  "vendor_reliability", "payment_terms", "budget_compliance",
  "source_quality", "specification_completeness",
];

export const DEFAULT_WEIGHTS = {
  price: 0.20, quality: 0.15, reviews: 0.10, delivery: 0.08, warranty: 0.07,
  vendor_reliability: 0.08, payment_terms: 0.04, budget_compliance: 0.08,
  source_quality: 0.10, specification_completeness: 0.10,
};

export function validateWeights(weights) {
  const errors = [];
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) return ["weights must be an object"];
  for (const [k, w] of Object.entries(weights)) {
    if (!CRITERIA.includes(k)) { errors.push(`unknown criterion: ${k}`); continue; }
    if (typeof w !== "number" || Number.isNaN(w)) errors.push(`non-numeric weight: ${k}`);
    else if (w < 0) errors.push(`negative weight: ${k}`);
  }
  return errors;
}

// Component normalizers: input evidence -> 0..1 | null (null = unavailable, excluded).
export function normalizePrice() { return null; } // placeholder: real price scoring needs comparable offers (none in Phase 2A dataset)
export function normalizeRating(rating, scale = 5) {
  if (typeof rating !== "number" || Number.isNaN(rating) || typeof scale !== "number" || !(scale > 0)) return null;
  if (rating < 0 || rating > scale) return null;
  return rating / scale;
}
export function budgetCompliance(netPrice, currency, budget, budgetCurrency) {
  if (typeof netPrice !== "number" || !(netPrice > 0) || !currency || budget === null || budget === undefined) return null;
  if (String(currency).toUpperCase() !== String(budgetCurrency).toUpperCase()) return null; // no FX: no verdict
  if (typeof budget !== "number" || !(budget > 0)) return null;
  return netPrice <= budget ? 1 : 0;
}

// components: { criterion: 0..1 | null }. weights: { criterion: number }.
// Returns full explainable breakdown. Deterministic: same input -> same output.
export function score(components, weights = DEFAULT_WEIGHTS) {
  const errs = validateWeights(weights);
  if (errs.length) throw new Error("invalid weights: " + errs.join("; "));
  const used = [], missing = [];
  let num = 0, den = 0;
  const breakdown = {};
  for (const c of CRITERIA) {
    const w = weights[c] ?? 0;
    const v = components?.[c];
    if (w === 0) continue; // zero-weighted criteria neither help nor hurt
    if (typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 1) {
      used.push(c); num += w * v; den += w; breakdown[c] = { score: v, weight: w, contribution: w * v };
    } else {
      missing.push(c); breakdown[c] = { score: null, weight: w, contribution: 0 };
    }
  }
  return {
    overall_score: den > 0 ? num / den : null,
    criteria_used: used, criteria_missing: missing,
    effective_weight_total: den, breakdown,
  };
}

// Deterministic rank: score desc (null last), then confidence desc, then product_id asc.
export function rankRows(rows) {
  return [...rows]
    .sort((a, b) => {
      const sa = a.overall_score, sb = b.overall_score;
      if (sa === null && sb === null) { /* fall through */ } else if (sa === null) return 1;
      else if (sb === null) return -1;
      else if (sb !== sa) return sb - sa;
      if ((b.confidence ?? 0) !== (a.confidence ?? 0)) return (b.confidence ?? 0) - (a.confidence ?? 0);
      return String(a.product_id).localeCompare(String(b.product_id));
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
