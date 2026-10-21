// BuyWise agent coordination contract: roles, bounded loops, message validation.
// Canonical lib (unit-tested, no provider calls). Agents are evidence-driven:
// each finishes its task with a recorded reason, and may request revisions from
// another agent instead of failing silently. Loop/timeout/cost caps prevent
// infinite cycles. The deterministic scoring engine is NOT an agent; agents may
// read its outputs but never rewrite its scores.

export const AGENTS = {
  orchestrator: { objective: "Advance the case through valid states in order; assign tasks; enforce loop caps; escalate deadlocks to human.",
    tools: ["state_manager", "task_assignment"], maxIterations: 1, stopping: "case decided/closed or explicit human gate reached", escalation: "human" },
  product_research: { objective: "Find real candidate products for the requirement from live providers.",
    tools: ["serpapiShoppingSearch", "tavily_search"], maxIterations: 2, stopping: ">=1 verified product or providers exhausted", escalation: "orchestrator" },
  vendor_research: { objective: "Attach real merchants and verified commercial offers to known products.",
    tools: ["serpapiShoppingSearch"], maxIterations: 2, stopping: "offers found for top products or provider evidence exhausted", escalation: "orchestrator" },
  review_quality: { objective: "Grade evidence strength per product; attribute ratings only on strict patterns; flag missing data.",
    tools: [], maxIterations: 1, stopping: "every product evaluated", escalation: "orchestrator" },
  comparison: { objective: "Normalize candidates and rank via the deterministic scoring engine; surface conflicts and gaps.",
    tools: ["scoring_engine(read-only)"], maxIterations: 1, stopping: "ranking persisted", escalation: "decision" },
  decision: { objective: "Apply mandatory/budget/contact gates to the ranking; choose PROCEED, NEGOTIATE, or INSUFFICIENT_DATA and the next action.",
    tools: [], maxIterations: 2, stopping: "decision persisted with blockers and next action", escalation: "human" },
  negotiation: { objective: "Draft (never send) a proposal from a verified offer when conditions allow.",
    tools: [], maxIterations: 1, stopping: "proposal persisted with do_not_send=true, or NOT_READY recorded", escalation: "human" },
  reevaluation: { objective: "Re-score revised terms with the same scoring engine; report deltas honestly.",
    tools: ["scoring_engine(read-only)"], maxIterations: 1, stopping: "reevaluation persisted or WAITING recorded", escalation: "human" },
  approval: { objective: "Present evidence, uncertainty, and risks; record one explicit human decision.",
    tools: [], maxIterations: 1, stopping: "APPROVED/REJECTED/CHANGES_REQUESTED by a named actor", escalation: "human" },
};

// Bounded-loop policy: at most MAX_REPLANS revision cycles per case; each tool
// call has the adapter's own 15 s timeout; a full pipeline run is client-capped.
export const MAX_REPLANS_PER_CASE = 1;
export const MAX_TOOL_RETRIES = 1;

const MESSAGE_TYPES = ["task_assignment", "evidence_report", "revision_request", "decision", "escalation", "handoff", "review_request"];
const MESSAGE_STATUS = ["sent", "acknowledged", "completed", "rejected"];
const SECRET_SHAPES = [/tvly-[A-Za-z0-9_-]{8,}/, /re_[A-Za-z0-9]{16,}/, /sk-(live|ant)-[A-Za-z0-9]+/, /Bearer [A-Za-z0-9._~-]{8,}/, /Basic [A-Za-z0-9+/=]{12,}/];

export function validateMessage(m = {}) {
  const bad = [];
  if (!AGENTS[m.sender_agent] && m.sender_agent !== "human") bad.push("unknown sender_agent");
  if (!AGENTS[m.recipient_agent] && m.recipient_agent !== "human") bad.push("unknown recipient_agent");
  if (m.sender_agent === m.recipient_agent) bad.push("sender and recipient must differ");
  if (!MESSAGE_TYPES.includes(m.message_type)) bad.push("unknown message_type");
  if (m.status !== undefined && !MESSAGE_STATUS.includes(m.status)) bad.push("unknown status");
  if (!m.objective || String(m.objective).length < 5) bad.push("objective required (min 5 chars)");
  if (["revision_request", "decision", "escalation"].includes(m.message_type) && !(m.reason && String(m.reason).trim())) {
    bad.push(`${m.message_type} requires a recorded reason`);
  }
  if (m.message_type === "revision_request" && !(m.requested_action && String(m.requested_action).trim())) {
    bad.push("revision_request requires requested_action");
  }
  if (m.payload !== undefined && (typeof m.payload !== "object" || m.payload === null || Array.isArray(m.payload))) bad.push("payload must be an object");
  if (m.evidence_refs !== undefined && !Array.isArray(m.evidence_refs)) bad.push("evidence_refs must be an array");
  if (m.tool_calls !== undefined && !Array.isArray(m.tool_calls)) bad.push("tool_calls must be an array");
  const tools = AGENTS[m.sender_agent]?.tools || [];
  if ((m.tool_calls || []).length > 0 && tools.length === 0) bad.push(`${m.sender_agent} has no permitted tools`);
  for (const t of (m.tool_calls || [])) {
    if (typeof t?.tool !== "string" || !t.tool) { bad.push("tool_calls entries need a tool name"); break; }
    if (tools.length && !tools.some((allowed) => t.tool === allowed || t.tool.startsWith(allowed.replace("(read-only)", "")))) {
      bad.push(`tool ${t.tool} not permitted for ${m.sender_agent}`);
    }
  }
  const blob = JSON.stringify({ p: m.payload ?? null, r: m.reason ?? "", e: m.evidence_refs ?? [] });
  if (blob.length > 20000) bad.push("message too large (20kb cap)");
  for (const rx of SECRET_SHAPES) {
    if (rx.test(String(m.reason ?? "")) || rx.test(JSON.stringify(m.payload ?? {}))) { bad.push("secret-shaped value rejected"); break; }
  }
  return { valid: bad.length === 0, reasons: bad };
}
