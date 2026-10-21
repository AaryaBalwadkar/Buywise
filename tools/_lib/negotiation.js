// BuyWise negotiation eligibility, targets, and facts-only drafting. No LLM, no simulation.
// A negotiation row exists ONLY for eligible real vendor+offer pairs. Otherwise the
// outcome is NOT_READY and NOTHING is persisted (no fake rows). Sending always requires
// human_confirmation=true AND an available contact channel; Phase 2B never sends.

// Quantity-aware money math (pure, unit-tested). All totals are line totals
// (unit × quantity) in the offer currency. They are PARTIAL estimates:
// shipping, taxes, delivery fees, and discounts beyond the stated terms are
// unknown and excluded — callers must label them as such, never as final cost.
export function lineTotals({ unitPrice, quantity, currency }) {
  const u = typeof unitPrice === "number" && isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null;
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  if (u === null || q === null) return { unit_price: u, quantity: q, currency: currency || null, line_total: null, partial: true };
  return { unit_price: u, quantity: q, currency: currency || null, line_total: Math.round(u * q * 100) / 100, partial: true };
}

// Budget basis statement: is the saved budget a TOTAL or a per-unit figure?
// Schema defines budget as the total procurement estimate; per-unit figures
// are always derived (budget / quantity) and labeled as such.
export function budgetBasis({ budget, quantity, currency }) {
  const b = typeof budget === "number" && isFinite(budget) && budget > 0 ? budget : null;
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  if (b === null) return { basis: "unavailable", note: "no budget saved: value-for-money gates cannot run" };
  if (q === null) return { basis: "total_only", total_budget: b, currency: currency || null, note: "total budget without quantity: no per-unit basis" };
  return { basis: "total", total_budget: b, unit_budget: Math.round((b / q) * 100) / 100, quantity: q, currency: currency || null, note: "budget is the TOTAL estimate; per-unit figures are derived" };
}

export function eligibleContact(vendor) {
  const c = vendor?.contact_channel;
  if (!c || typeof c !== "object") return { ok: false, reason: "no vendor contact information" };
  if (!c.type || !c.address) return { ok: false, reason: "incomplete contact channel" };
  if (c.status === "UNAVAILABLE") return { ok: false, reason: "contact channel unavailable" };
  if (!c.source_url) return { ok: false, reason: "contact without verifiable source" };
  return { ok: true };
}

export function validateEligibility({ vendor, offer, procurement }) {
  const reasons = [];
  if (!vendor?.vendor_id || !vendor?.vendor_name || vendor.vendor_name === "unavailable") reasons.push("no verified vendor identity");
  if (!vendor?.source_url) reasons.push("no vendor source URL");
  if (!offer?.offer_id || !offer?.product_id) reasons.push("no real offer");
  if (!(typeof offer?.net_price === "number" && offer.net_price > 0)) reasons.push("no verified price");
  if (!offer?.currency) reasons.push("no offer currency");
  const contact = eligibleContact(vendor);
  if (!contact.ok) reasons.push(contact.reason);
  const ccyMatch = offer?.currency && procurement?.currency && String(offer.currency).toUpperCase() === String(procurement.currency).toUpperCase();
  if (offer?.currency && procurement?.currency && !ccyMatch) reasons.push("currency mismatch (no FX source)");
  return { eligible: reasons.length === 0, reasons };
}

// Target ONLY from explicit constraints: procurement budget, or an explicitly allowed
// discount percent. No assumed 5/10/15%. Returns { target_price, basis } or nulls.
export function computeTarget({ current_price, currency, budget, budgetCurrency, allowed_discount_pct = null }) {
  if (!(typeof current_price === "number" && current_price > 0) || !currency) return { target_price: null, basis: null };
  const sameCcy = budgetCurrency && String(currency).toUpperCase() === String(budgetCurrency).toUpperCase();
  if (typeof budget === "number" && budget > 0 && sameCcy && budget < current_price) {
    return { target_price: budget, basis: "procurement_budget" };
  }
  if (typeof allowed_discount_pct === "number" && allowed_discount_pct > 0 && allowed_discount_pct < 100) {
    return { target_price: Math.round(current_price * (1 - allowed_discount_pct / 100) * 100) / 100, basis: `explicit_allowed_discount:${allowed_discount_pct}%` };
  }
  return { target_price: null, basis: null };
}

export function buildRequest({ procurement_id, product_id, vendor, offer, target_price, target_basis, requested_terms = [] }) {
  const elig = validateEligibility({ vendor, offer, procurement: { currency: offer?.currency } });
  if (!elig.eligible) return { status: "NOT_READY", reasons: elig.reasons };
  if (target_price === null || target_price === undefined) return { status: "NOT_READY", reasons: ["no negotiation target (target_price unavailable)"] };
  const discount = Math.round((1 - target_price / offer.net_price) * 10000) / 100;
  return {
    status: "READY_FOR_HUMAN_REVIEW",
    negotiation: {
      procurement_id, product_id, vendor_id: vendor.vendor_id, offer_id: offer.offer_id,
      current_price: offer.net_price, currency: String(offer.currency).toUpperCase(),
      target_price, requested_discount_percent: discount, requested_terms,
      contact_channel: vendor.contact_channel, human_confirmation: false, do_not_send: true,
    },
    target_basis,
  };
}

// Facts-only draft: every interpolated value comes from the request + procurement facts.
// No previous conversations, competitor quotes, policies, volumes, or promises.
export function draftMessage({ negotiation, procurement, product }) {
  if (!negotiation) throw new Error("draftMessage: negotiation required");
  const facts = [
    `Product: ${product?.name ?? negotiation.product_id}`,
    `Current verified price: ${negotiation.current_price} ${negotiation.currency}`,
    `Requested price: ${negotiation.target_price} ${negotiation.currency}`,
  ];
  if (procurement?.quantity) facts.push(`Quantity: ${procurement.quantity}`);
  const changes = [`Unit price ${negotiation.current_price} ${negotiation.currency} -> ${negotiation.target_price} ${negotiation.currency}`];
  for (const t of negotiation.requested_terms || []) changes.push(String(t));
  const subject = `Price request: ${product?.name ?? negotiation.product_id} (${negotiation.current_price} ${negotiation.currency})`;
  const body = [
    `Dear ${negotiation.contact_channel?.address ?? "Sales team"},`,
    ``,
    `We are evaluating ${product?.name ?? negotiation.product_id} listed at ${negotiation.current_price} ${negotiation.currency}${procurement?.quantity ? ` (quantity ${procurement.quantity})` : ""}.`,
    `We would like to request a revised quotation at ${negotiation.target_price} ${negotiation.currency}.`,
    ...(negotiation.requested_terms || []).map((t) => `We would also like to discuss: ${t}.`),
    ``,
    `Please reply with your best revised quotation. This request is subject to our standard procurement review; no order is placed by this message.`,
  ].join("\n");
  return { subject, body, facts_used: facts, requested_changes: changes, evidence_urls: product?.evidence_urls ?? [] };
}

export function canSend({ human_confirmation, contact_channel }) {
  if (human_confirmation !== true) return { send: false, do_not_send: true, reason: "human_confirmation missing" };
  const c = eligibleContact({ contact_channel });
  if (!c.ok) return { send: false, do_not_send: true, reason: c.reason };
  return { send: true, do_not_send: false, reason: "confirmed with available channel (sending is Phase 2C)" };
}

// Duplicate guard helper (DB UNIQUE(procurement_id, offer_id) enforces; check first for clean errors).
export function isDuplicate(existingRows, procurement_id, offer_id) {
  return (existingRows || []).some((r) => r.procurement_id === procurement_id && r.offer_id === offer_id);
}
