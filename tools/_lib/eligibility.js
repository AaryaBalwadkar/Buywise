// BuyWise eligibility assessment: mandatory requirements evaluated per product
// with PASS / FAIL / UNKNOWN verdicts + evidence. UNKNOWN means "no verified
// spec" — never a silent pass, never a zero, never invented. Preferences
// (preferred_specs) are reported separately and never gate eligibility.
import { checkMandatory } from "./decision.js";

// Normalize intake-style mandatory specs ({ ram_gb_min: 16 }) into gate rules
// ({ ram_gb: { min: 16 } }). Same mapping the Decision Agent uses — one rule.
export function normalizeMandatory(mandatorySpecs = {}) {
  const mandatory = {};
  const mspecs = (typeof mandatorySpecs === "string" ? JSON.parse(mandatorySpecs || "{}") : (mandatorySpecs || {}));
  for (const [k, v] of Object.entries(mspecs)) {
    const s = String(k);
    if (s.endsWith("_min")) mandatory[s.slice(0, -4)] = { min: v };
    else if (s.endsWith("_max")) mandatory[s.slice(0, -4)] = { ...(mandatory[s.slice(0, -4)] || {}), max: v };
    else mandatory[s] = { equals: v };
  }
  return mandatory;
}

// productsById: { product_id: { specifications } }. mandatory: { field: rule }.
// preferences: { field: value } informational only.
// Returns [{ product_id, requirement, verdict, evidence }].
export function assessEligibility({ productsById = {}, mandatory = {}, preferences = {} }) {
  const rows = [];
  const prefKeys = new Set(Object.keys(preferences || {}));
  for (const [pid, product] of Object.entries(productsById)) {
    const specs = (product && product.specifications && typeof product.specifications === "object") ? product.specifications : {};
    const check = checkMandatory(specs, mandatory);
    for (const [field] of Object.entries(mandatory || {})) {
      const isFailed = check.failed.some((f) => String(f).startsWith(field + "=") || String(f).startsWith(field + " "));
      const isUnverifiable = check.unverifiable.includes(field);
      const raw = specs[field] ?? specs[field.replace(/_gb_min$/, "_gb")] ?? specs[field.replace(/_min$/, "")];
      rows.push({
        product_id: pid,
        requirement: field,
        verdict: isFailed ? "FAIL" : (isUnverifiable ? "UNKNOWN" : "PASS"),
        evidence: { spec_value: raw ?? "unavailable", mandatory: true },
      });
    }
    for (const field of prefKeys) {
      rows.push({
        product_id: pid,
        requirement: field,
        verdict: "UNKNOWN",
        evidence: { spec_value: specs[field] ?? "unavailable", mandatory: false, note: "preference, never gates eligibility" },
      });
    }
  }
  return rows;
}

// Candidate lists for UI: eligible (no FAIL, at least one mandatory assessed or
// none required), rejected (any FAIL), unresolved (UNKNOWN only / not assessed).
export function groupCandidates({ productIds = [], eligibility = [], mandatory = {} }) {
  const reqCount = Object.keys(mandatory || {}).length;
  const byProduct = {};
  for (const r of eligibility) (byProduct[r.product_id] ||= []).push(r);
  const eligible = [], rejected = [], unresolved = [];
  for (const pid of productIds) {
    const rows = (byProduct[pid] || []).filter((r) => r.evidence?.mandatory);
    if (rows.some((r) => r.verdict === "FAIL")) { rejected.push(pid); continue; }
    if (reqCount > 0 && rows.length > 0 && rows.every((r) => r.verdict === "PASS")) { eligible.push(pid); continue; }
    if (reqCount === 0) { eligible.push(pid); continue; }
    unresolved.push(pid);
  }
  return { eligible, rejected, unresolved };
}
