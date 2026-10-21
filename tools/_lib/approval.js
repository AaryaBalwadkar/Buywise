// BuyWise approval package validation, human-decision gates, and closure rules.
// The Approval Agent PREPARES and WAITS. It never approves, never auto-closes
// (except the explicit decided→closed PROCEED business rule handled by the
// orchestrator flag, recorded with its rule). No purchasing: no PO/payment/checkout.

export const APPROVAL_OUTCOMES = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"];
const PLACEHOLDER_ACTORS = ["", "unknown", "n/a", "tbd", "test", "todo", "none", "manager", "admin", "administrator", "approver", "owner", "user", "system"];

// Package sections that must exist (values may honestly be unavailable/empty,
// but the SECTION must be present so gaps are visible, never hidden).
const REQUIRED_SECTIONS = [
  "procurement_request", "selected_product", "selected_vendor", "original_offer",
  "revised_offer", "original_score", "revised_score", "savings", "quality_evidence",
  "review_evidence", "delivery_information", "warranty_information", "payment_terms",
  "criteria_used", "criteria_missing", "limitations", "evidence_urls", "negotiation_history",
];

export function validatePackage(pkg) {
  const missing = REQUIRED_SECTIONS.filter((s) => pkg?.[s] === undefined);
  return { complete: missing.length === 0, missing };
}

export function validateActor(actor) {
  if (typeof actor !== "string") return { ok: false, reason: "actor must be a string" };
  const a = actor.trim();
  if (a.length < 2) return { ok: false, reason: "actor identity too short" };
  if (PLACEHOLDER_ACTORS.includes(a.toLowerCase())) return { ok: false, reason: "placeholder actor identity" };
  return { ok: true, actor: a };
}

export function validateDecisionInput({ approval_id, procurement_id, decision, actor, decided_at }) {
  const bad = [];
  if (!approval_id) bad.push("approval_id missing");
  if (!procurement_id) bad.push("procurement_id missing");
  if (!APPROVAL_OUTCOMES.includes(decision)) bad.push(`invalid decision (absence/timeout/views are never approval): ${decision}`);
  const av = validateActor(actor);
  if (!av.ok) bad.push(av.reason);
  if (!decided_at) bad.push("decision timestamp missing");
  return { valid: bad.length === 0, reasons: bad };
}

// Closure wrapper: ONLY explicit human outcomes close. changes_requested never closes.
export function closureTransition(decision) {
  if (decision === "APPROVED") return { close: true, status: "closed", event: "approval_approved" };
  if (decision === "REJECTED") return { close: true, status: "closed", event: "approval_rejected" };
  if (decision === "CHANGES_REQUESTED") return { close: false, status: "changes_requested", event: "approval_changes_requested" };
  return { close: false, status: null, event: null };
}

export function isDuplicateApproval(existingApprovals, procurement_id) {
  return (existingApprovals || []).some((a) => a.procurement_id === procurement_id && a.status === "PENDING_APPROVAL");
}

export function isExpired(approval, now = new Date()) {
  if (!approval?.expires_at) return false;
  return new Date(approval.expires_at).getTime() <= now.getTime();
}
