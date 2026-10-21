// BuyWise procurement lifecycle: one central state model. Backend code enforces
// these transitions; the frontend only displays them. Same-state writes are
// harmless no-ops. `closed` and `purchase_handoff` are terminal: nothing leaves
// them (a new request starts a new case — history is never rewritten).

export const TRANSITIONS = {
  created: ["product_done", "vendor_done", "quality_done", "compared", "decided", "partial", "failed", "needs_human_intervention", "demo_negotiating", "pending_approval"],
  partial: ["product_done", "vendor_done", "quality_done", "compared", "decided", "failed", "needs_human_intervention", "demo_negotiating", "pending_approval"],
  product_done: ["vendor_done", "quality_done", "compared", "decided", "failed", "needs_human_intervention"],
  vendor_done: ["quality_done", "compared", "decided", "failed", "needs_human_intervention"],
  quality_done: ["compared", "decided", "failed", "needs_human_intervention"],
  compared: ["decided", "failed", "needs_human_intervention"],
  decided: ["negotiating", "demo_negotiating", "pending_approval", "compared", "failed", "needs_human_intervention"],
  negotiating: ["reevaluated", "pending_approval", "failed", "needs_human_intervention"],
  demo_negotiating: ["demo_response_received", "pending_approval", "failed"],
  demo_response_received: ["reevaluated", "pending_approval", "failed"],
  reevaluated: ["pending_approval", "demo_negotiating", "failed"],
  pending_approval: ["closed", "changes_requested", "failed"],
  changes_requested: ["pending_approval", "decided", "compared", "failed"],
  failed: ["created", "partial"],
  needs_human_intervention: ["created", "partial", "failed"],
  // `closed` admits exactly one exit: the verified purchase handoff
  // (guarded by canHandoff in the endpoint, not by this map alone).
  closed: ["purchase_handoff"],
  purchase_handoff: [],
};

export const TERMINAL = ["closed", "purchase_handoff"];

export function canTransition(from, to) {
  if (from === to) return { ok: true, noop: true };
  const allowed = TRANSITIONS[from];
  if (!allowed) return { ok: false, reason: `unknown current state '${from}'` };
  if (!allowed.includes(to)) {
    return { ok: false, reason: `illegal transition '${from}' -> '${to}' (allowed: ${allowed.join(", ") || "none — terminal"})` };
  }
  return { ok: true, noop: false };
}

// Closure rules: a case may close only on a recorded human decision, and a
// purchase handoff only after a REAL approval. Returns {ok, reason}.
export function canClose(decision, mode) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    return { ok: false, reason: `closure requires APPROVED or REJECTED, got '${decision}'` };
  }
  return { ok: true };
}

// Handoff = real purchase authorization. Requires ALL of:
// - closed case, latest approval APPROVED + REAL (DEMO is simulation only),
// - latest decision PROCEED (INSUFFICIENT_DATA / NEGOTIATE / NO_ELIGIBLE_OFFERS /
//   RESEARCH_REQUIRED must never hand off directly — recompute first),
// - caller-supplied freshness already verified by the endpoint (version/offer/
//   scoring checks in server.js); this pure gate fails closed on missing input.
export function canHandoff({ caseStatus, latestApproval, latestDecision }) {
  if (caseStatus !== "closed") return { ok: false, reason: "handoff requires a closed case" };
  if (!latestApproval || latestApproval.status !== "APPROVED") {
    return { ok: false, reason: "handoff requires a recorded APPROVED approval" };
  }
  if (latestApproval.mode !== "REAL") {
    return { ok: false, reason: "a DEMO approval is simulation only and is never purchasing authorization" };
  }
  const dec = typeof latestDecision === "string" ? latestDecision : latestDecision?.decision;
  if (dec !== "PROCEED") {
    return { ok: false, reason: `handoff requires a current PROCEED decision, got '${dec ?? "none"}'` };
  }
  return { ok: true };
}

// Stale-package guard: the approval must still describe the current facts.
// Any mismatch fails closed (caller requests a fresh package).
export function isApprovalStale({ approval, current }) {
  const reasons = [];
  if (!approval) return { stale: true, reasons: ["no approval"] };
  if ((approval.mode || "REAL") !== (current.mode || "REAL")) {
    reasons.push(`mode changed (${approval.mode} -> ${current.mode})`);
  }
  if (approval.request_version != null && current.version != null && approval.request_version !== current.version) {
    reasons.push(`request v${approval.request_version} is stale (case is v${current.version})`);
  }
  const aOff = approval.selected_offer_id ?? approval?.approval_package?.original_offer?.offer_id;
  if (aOff && current.selected_offer_id && aOff !== current.selected_offer_id) {
    reasons.push("selected offer changed since review");
  }
  const pkgPrice = approval?.approval_package?.original_offer?.net_price;
  if (pkgPrice != null && current.offer_price != null && Number(pkgPrice) !== Number(current.offer_price)) {
    reasons.push("selected offer price changed since review");
  }
  const pkgCcy = approval?.approval_package?.original_offer?.currency;
  if (pkgCcy && current.offer_currency && String(pkgCcy).toUpperCase() !== String(current.offer_currency).toUpperCase()) {
    reasons.push("selected offer currency changed since review");
  }
  if (approval.scoring_version && current.scoring_version && approval.scoring_version !== current.scoring_version) {
    reasons.push(`scoring version changed (${approval.scoring_version} -> ${current.scoring_version})`);
  }
  const pkgQty = approval?.approval_package?.procurement_request?.quantity;
  if (pkgQty != null && current.quantity != null && Number(pkgQty) !== Number(current.quantity)) {
    reasons.push("quantity changed since review (totals stale)");
  }
  const pkgBudget = approval?.approval_package?.procurement_request?.budget;
  if (pkgBudget != null && current.budget != null && Number(pkgBudget) !== Number(current.budget)) {
    reasons.push("budget changed since review (totals stale)");
  }
  return { stale: reasons.length > 0, reasons };
}
