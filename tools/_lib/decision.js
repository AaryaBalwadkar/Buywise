// BuyWise DETERMINISTIC decision gates. No LLM, no scoring here (scores come from
// the scoring engine). Outcomes: PROCEED (recommendation supported), NEGOTIATE
// (verified over-budget offer + real channel), NO_ELIGIBLE_OFFERS (nothing
// purchasable), RESEARCH_REQUIRED (blocked only by fillable gaps),
// INSUFFICIENT_DATA (structural blocks research cannot fix).
// Scans ranked candidates in order; first candidate clearing all gates wins.
// NOTHING is invented: unverified mandatory specs block, they never pass.
// Returns { decision, product_id, comparison_id, decision_reason, blocking_reasons,
// criteria_used, criteria_missing, evidence_urls }.

function num(v) { return typeof v === "number" && !Number.isNaN(v) ? v : null; }

// mandatory: { field: { min?: number, max?: number, equals?: string } }.
// A VERIFIED spec violating a constraint fails the candidate. An UNVERIFIED spec
// blocks with 'mandatory_unverifiable:<field>' (never assumed satisfied).
export function checkMandatory(specifications, mandatory = {}) {
  const failed = [], unverifiable = [];
  const specs = specifications && typeof specifications === "object" ? specifications : {};
  const lower = Object.fromEntries(Object.entries(specs).map(([k, v]) => [String(k).toLowerCase(), v]));
  const isMissing = (v) => v === null || v === undefined || (typeof v === "string" && v.trim().toLowerCase() === "unavailable");
  for (const [field, rule] of Object.entries(mandatory || {})) {
    const v = lower[field.toLowerCase()];
    if (isMissing(v)) { unverifiable.push(field); continue; }
    if (rule && typeof rule.min === "number" && num(v) !== null && num(v) < rule.min) failed.push(`${field}=${v} below minimum ${rule.min}`);
    if (rule && typeof rule.max === "number" && num(v) !== null && num(v) > rule.max) failed.push(`${field}=${v} above maximum ${rule.max}`);
    if (rule && typeof rule.equals === "string" && String(v).toLowerCase() !== rule.equals.toLowerCase()) failed.push(`${field}=${v} must equal ${rule.equals}`);
  }
  return { failed, unverifiable };
}

export function decide({ procurement, ranked = [], offersByProduct = {}, vendorsById = {}, productsById = {}, mandatory = {} }) {
  if (!procurement?.procurement_id) throw new Error("decide: procurement required");
  if (!Array.isArray(ranked) || !ranked.length) {
    return { decision: "NO_ELIGIBLE_OFFERS", product_id: null, comparison_id: null, decision_reason: "No ranked candidates available for decision.", blocking_reasons: ["no ranked candidates"], criteria_used: [], criteria_missing: [], evidence_urls: [] };
  }
  const caseCcy = procurement.currency ? String(procurement.currency).toUpperCase() : null;
  const budget = num(procurement.budget);
  let rank1 = null, rank1blocking = null, blockedOthers = 0, failedCount = 0, offersSeenAny = false;
  for (const row of ranked) {
    const product = productsById[row.product_id] || {};
    const blocking = [];
    if (row.overall_score === null || row.overall_score === undefined) blocking.push("no scoring basis (overall_score null)");
    const specCheck = checkMandatory(product.specifications, mandatory);
    if (specCheck.failed.length) { failedCount++; if (row.rank === 1) { rank1 = row; rank1blocking = specCheck.failed.map((f) => `mandatory_failed:${f}`); } else blockedOthers++; continue; }
    if (specCheck.unverifiable.length) blocking.push(...specCheck.unverifiable.map((f) => `mandatory_unverifiable:${f}`));
    const offers = (offersByProduct[row.product_id] || []).filter((o) => num(o.net_price) !== null && num(o.net_price) > 0 && o.currency);
    if (offers.length) offersSeenAny = true;
    const sameCcy = caseCcy ? offers.filter((o) => String(o.currency).toUpperCase() === caseCcy) : [];
    if (!offers.length) blocking.push("no verified offers");
    else if (caseCcy && !sameCcy.length) blocking.push("no currency-compatible offer (no FX source)");
    const withContact = sameCcy.filter((o) => vendorsById[o.vendor_id]?.contact_channel && vendorsById[o.vendor_id].contact_channel.status !== "UNAVAILABLE");
    if (offers.length && !withContact.length) blocking.push("no vendor contact channel");
    if (blocking.length) {
      if (row.rank === 1) { rank1 = row; rank1blocking = blocking; }
      else blockedOthers++;
      continue; // try the next-ranked candidate; never assume, never force
    }
    // Candidate clears evidence gates: choose PROCEED vs NEGOTIATE on verified commercial facts.
// Budget is a TOTAL budget for `quantity` units; offers carry UNIT prices.
// Compare like with like: total_estimate (unit x qty) vs total budget, which is
// equivalent to unit vs unit_budget. Missing quantity/currency => no verdict,
// never assumed within budget.
    const best = Math.min(...sameCcy.map((o) => o.net_price));
    const bestOffer = sameCcy.find((o) => o.net_price === best);
    const qty = Number.isInteger(procurement.quantity) && procurement.quantity > 0 ? procurement.quantity : null;
    const totalEst = qty !== null ? best * qty : null;
    if (budget !== null && qty !== null && totalEst !== null && totalEst > budget) {
      return explain("NEGOTIATE", row, `Verified total estimate ${totalEst} ${caseCcy} (unit ${best} x ${qty}) exceeds total budget ${budget} ${caseCcy}; a real vendor channel exists, negotiation is legitimate.`, [], bestOffer);
    }
    if (budget !== null && (qty === null || totalEst === null)) {
      return explain("PROCEED", row, `Sufficient verified evidence; best verified unit price ${best} ${caseCcy} (quantity/budget basis unavailable, totals partial); no blocking issue.`, [], bestOffer);
    }
    return explain("PROCEED", row, `Sufficient verified evidence; best verified total estimate ${totalEst} ${caseCcy} (unit ${best} x ${qty})${budget !== null ? ` within total budget ${budget} ${caseCcy}` : ""}; no blocking issue.`, [], bestOffer);
  }
  const top = rank1 || ranked[0];
  const blocking = [...(rank1blocking || ["no candidate clears gates"]), ...(blockedOthers ? [`${blockedOthers} lower-ranked candidate(s) also blocked`] : [])];
  // Outcome mapping (deterministic, propositionally disjoint):
  // - NO_ELIGIBLE_OFFERS: nothing purchasable — empty ranking, every candidate
  //   failed mandatory gates, or zero verified offers across all candidates.
  // - RESEARCH_REQUIRED: top candidate is otherwise assessable but blocked only
  //   by fillable gaps (unverifiable mandatory specs and/or missing offers) —
  //   targeted research or requester clarification may resolve them.
  // - INSUFFICIENT_DATA: structural blocks (no scoring basis, no contact
  //   channel, currency mismatch) that research cannot fix.
  const allFailed = ranked.length > 0 && failedCount === ranked.length;
  const anyOffers = offersSeenAny;
  const fillableOnly = rank1blocking && rank1blocking.length > 0
    && rank1blocking.every((b) => b.startsWith("mandatory_unverifiable:") || b === "no verified offers");
  if (ranked.length === 0) {
    return explain("NO_ELIGIBLE_OFFERS", { product_id: null },
      "No ranked candidates available for decision.", ["no ranked candidates"]);
  }
  if (allFailed) {
    return explain("NO_ELIGIBLE_OFFERS", top,
      "Every candidate fails mandatory requirements: " + (rank1blocking || []).join("; ") + ".", blocking);
  }
  if (!anyOffers) {
    return explain("NO_ELIGIBLE_OFFERS", top,
      (rank1blocking ? "Top candidate cannot support a reliable decision: " + rank1blocking.join("; ") + ". " : "") + "No verified offers exist for any candidate.",
      blocking.includes("no verified offers") ? blocking : [...blocking, "no verified offers"]);
  }
  if (fillableOnly) {
    const fields = rank1blocking.filter((b) => b.startsWith("mandatory_unverifiable:")).map((b) => b.slice("mandatory_unverifiable:".length));
    return explain("RESEARCH_REQUIRED", top,
      "Top candidate is blocked only by fillable gaps"
      + (fields.length ? ` (unverified: ${fields.join(", ")})` : "")
      + (rank1blocking.includes("no verified offers") ? "; no verified offer for it yet" : "")
      + ". Targeted research or requester clarification may resolve this.",
      blocking);
  }
  return explain("INSUFFICIENT_DATA", top, rank1blocking ? "Top candidate cannot support a reliable decision: " + rank1blocking.join("; ") + "." : "No ranked candidate clears mandatory and evidence gates.", blocking);

  function explain(decision, row, reason, blocking, offer = null) {
    return {
      decision, product_id: row.product_id, comparison_id: row.comparison_id ?? null,
      decision_reason: reason, blocking_reasons: blocking,
      criteria_used: row.criteria_used ?? [], criteria_missing: row.criteria_missing ?? [],
      evidence_urls: row.evidence_urls ?? [],
      _offer: offer ? { offer_id: offer.offer_id, vendor_id: offer.vendor_id, net_price: offer.net_price, currency: offer.currency } : null,
    };
  }
}
