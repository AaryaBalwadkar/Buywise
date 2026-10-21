// BuyWise DEMO MODE guards. REAL mode behavior is NEVER altered by this module.
// Demo = explicitly human-entered local responses, always labeled DEMO_HUMAN_ENTERED
// with vendor_response_verified=false. Demo data must NEVER enter REAL code paths
// without mode==='DEMO' stated explicitly at every layer.

export const DEMO_LABELS = {
  response_mode: "DEMO_HUMAN_ENTERED",
  source: "LOCAL_DEMO_INPUT",
  vendor_response_verified: false,
  entered_by: "HUMAN",
};

// Mode switch: REAL default; DEMO only when explicitly requested with a reason.
export function selectMode({ current = "REAL", requested, reason }) {
  if (requested === undefined || requested === null) return { mode: current, switched: false };
  if (!["REAL", "DEMO"].includes(requested)) throw new Error(`unknown mode: ${requested}`);
  if (requested === "DEMO" && (!reason || !String(reason).trim())) {
    throw new Error("explicit DEMO selection requires a reason (never silent)");
  }
  return { mode: requested, switched: requested !== current, reason: reason ?? null };
}

// Validate a human-entered demo response. Currency must match the offer currency
// (no FX). Price numeric > 0. Never prepopulated: empty call is rejected.
export function validateDemoResponse({ offer, revised_price, currency, delivery_days, warranty, payment_terms, notes }) {
  const bad = [];
  if (!offer?.offer_id) bad.push("no real offer reference");
  const rp = typeof revised_price === "number" ? revised_price : Number(revised_price);
  if (!(rp > 0) || Number.isNaN(rp)) bad.push("revised price must be an explicitly entered number > 0");
  if (!currency || (offer?.currency && String(currency).toUpperCase() !== String(offer.currency).toUpperCase())) {
    bad.push("demo currency must match the offer currency (no conversion)");
  }
  return { valid: bad.length === 0, reasons: bad };
}

// REAL-mode blocker proof: with no verified contact, REAL negotiation is impossible.
// Returns the exact blocker chain; never fabricates a way through.
export function realModeBlockers({ vendors = [], offers = [], procurement = {} }) {
  const blockers = [];
  if (!offers.length) blockers.push("no verified offers");
  const withContact = vendors.filter((v) => v.contact_channel && v.contact_channel.status !== "UNAVAILABLE");
  if (!withContact.length) blockers.push("no verified contact channel");
  if (!procurement?.currency) blockers.push("no procurement currency");
  return { blocked: blockers.length > 0, blockers, sent: 0, contacted: 0 };
}

// Demo/REAL confusion guard for any persisted or displayed record.
export function assertDemoLabeled(record) {
  const bad = [];
  if (record?.mode === "DEMO") {
    if (record.response_mode !== undefined && record.response_mode !== "DEMO_HUMAN_ENTERED") bad.push("demo record mislabeled");
    if (record.vendor_response_verified === true) bad.push("demo record claims verified vendor response");
    if (record.event_type === "VENDOR_RESPONSE_RECEIVED" || record.status === "VENDOR_RESPONSE_RECEIVED") {
      bad.push("demo used a REAL vendor-response status");
    }
  }
  return { ok: bad.length === 0, reasons: bad };
}
