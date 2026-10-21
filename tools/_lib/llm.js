// BuyWise optional LLM reasoning (ADVISORY ONLY, hosted endpoint).
// The deterministic core (gates, scoring, validation, policy, loop caps, safety
// checks) never depends on this module. When credentials are absent the system
// runs the deterministic fallback and says so; deterministic output is never
// labelled LLM-generated. Credentials come from env only and are never logged,
// returned, or persisted — config objects carry a boolean, never key material.

import { AGENTS } from "./coordination.js";

export const LLM_TIMEOUT_MS = 20000;
export const LLM_MAX_TOKENS = 800;

export const ADVISORY_ACTIONS = {
  decision: ["proceed_to_approval", "request_targeted_research", "escalate_human", "accept_insufficient"],
  comparison: ["accept_ranking", "flag_conflicts", "request_evidence"],
};

// Config carries NO key material (hasKey boolean only).
export function getLLMConfig(env = process.env) {
  const provider = String(env.LLM_PROVIDER || "none").trim().toLowerCase();
  const apiUrl = String(env.LLM_API_URL || "").trim().replace(/\/+$/, "");
  const model = String(env.LLM_MODEL || "").trim();
  const hasKey = !!(env.LLM_API_KEY && String(env.LLM_API_KEY).trim());
  if (provider === "openai-compatible" && apiUrl && hasKey && model) {
    return { provider, apiUrl, model, configured: true };
  }
  return { provider: "none", apiUrl: "", model: "", configured: false };
}

// System-level indicator: LLM_REASONING (creds configured) or LLM_UNAVAILABLE.
// Per-execution DETERMINISTIC_FALLBACK is recorded when an agent runs without
// LLM input (unconfigured, timeout, malformed output).
export function systemReasoningMode(env = process.env) {
  return getLLMConfig(env).configured ? "LLM_REASONING" : "LLM_UNAVAILABLE";
}

function redact(s) {
  return String(s ?? "").replace(/sk-[A-Za-z0-9._~-]{4,}/g, "[redacted]")
    .replace(/Bearer [A-Za-z0-9._~-]{4,}/g, "Bearer [redacted]");
}

// Minimal OpenAI-compatible chat client returning parsed JSON. fetchImpl is
// injectable so tests never touch the network. Throws redacted errors.
export async function chatJSON({ system, user, config, env = process.env, timeoutMs = LLM_TIMEOUT_MS, fetchImpl = fetch }) {
  if (!config?.configured) throw new Error("LLM unavailable: no credentials configured");
  const key = String(env.LLM_API_KEY || "").trim();
  if (!key) throw new Error("LLM unavailable: no credentials configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  let res;
  try {
    res = await fetchImpl(config.apiUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.model, temperature: 0, max_tokens: LLM_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw new Error(`LLM request failed: ${redact(e.message).slice(0, 120)}`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`LLM request failed: http ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("LLM returned malformed (non-JSON) response");
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM returned empty content");
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new Error("LLM returned malformed (non-JSON) response");
  }
}

// Validated advisory contract. No hidden chain-of-thought: only a concise
// reasoning summary, evidence refs, uncertainties, and a bounded action.
export function validateAdvisory(a = {}, kind = "decision") {
  const bad = [];
  if (!a || typeof a !== "object" || Array.isArray(a)) return { valid: false, reasons: ["advisory must be an object"] };
  for (const f of ["role", "task", "reasoning_summary"]) {
    if (!a[f] || String(a[f]).length < 5) bad.push(`${f} required (min 5 chars)`);
  }
  for (const f of ["evidence_considered", "missing_info", "uncertainties"]) {
    if (!Array.isArray(a[f])) bad.push(`${f} must be an array`);
  }
  const allowed = ADVISORY_ACTIONS[kind] || [];
  if (!allowed.includes(a.proposed_action)) bad.push(`proposed_action must be one of ${allowed.join(", ")}`);
  if (a.handoff_request !== null && a.handoff_request !== undefined) {
    const h = a.handoff_request;
    if (!h || typeof h !== "object") bad.push("handoff_request must be an object or null");
    else {
      if (!AGENTS[h.agent] && h.agent !== "human") bad.push("handoff_request.agent unknown");
      if (!h.action || String(h.action).length < 5) bad.push("handoff_request.action required");
      if (!h.reason || String(h.reason).length < 5) bad.push("handoff_request.reason required");
    }
  }
  if (a.completion !== "complete" && a.completion !== "escalate") bad.push("completion must be complete|escalate");
  return { valid: bad.length === 0, reasons: bad };
}

const COMMON_RULES = `Rules: reply with a single JSON object only, no hidden chain-of-thought, no markdown.
Only cite evidence given in EVIDENCE. Never invent prices, merchants, reviews, or URLs.
Scores and gates are computed elsewhere; you advise, you do not decide.`;

export function buildDecisionPrompt({ requirement, rankedTop = [], blocking = [], offersCount = 0, mode = "REAL" }) {
  const system = `You are the BuyWise Decision Agent advisor (procurement assistant). ${COMMON_RULES}`;
  const user = `TASK: evaluate procurement evidence and recommend the next permitted action.
REQUIREMENT: ${String(requirement || "").slice(0, 500)}
MODE: ${mode}
TOP_CANDIDATES: ${JSON.stringify(rankedTop).slice(0, 2000)}
VERIFIED_OFFERS: ${offersCount}
DETERMINISTIC_GATE_BLOCKERS: ${JSON.stringify(blocking).slice(0, 1000)}
EVIDENCE: the candidates, blockers, and offer count above only.
Respond with exactly: {"role": "...", "task": "...", "evidence_considered": [...],
"reasoning_summary": "...", "missing_info": [...], "uncertainties": [...],
"proposed_action": "proceed_to_approval|request_targeted_research|escalate_human|accept_insufficient",
"handoff_request": null or {"agent": "...", "action": "...", "reason": "..."},
"completion": "complete|escalate"}`;
  return { system, user };
}

export function buildComparisonPrompt({ rankedCount = 0, conflicts = [], unofferedTop = [], criteriaUsed = [] }) {
  const system = `You are the BuyWise Comparison Agent advisor (procurement assistant). ${COMMON_RULES}`;
  const user = `TASK: review a deterministic ranking and identify conflicts or evidence gaps.
RANKED_CANDIDATES: ${rankedCount}
CURRENCY_CONFLICTS (multi-currency offers, never converted): ${JSON.stringify(conflicts).slice(0, 800)}
TOP_PRODUCTS_WITHOUT_OFFERS: ${JSON.stringify(unofferedTop).slice(0, 800)}
CRITERIA_USED: ${JSON.stringify(criteriaUsed).slice(0, 800)}
EVIDENCE: the counts and lists above only.
Respond with exactly: {"role": "...", "task": "...", "evidence_considered": [...],
"reasoning_summary": "...", "missing_info": [...], "uncertainties": [...],
"proposed_action": "accept_ranking|flag_conflicts|request_evidence",
"handoff_request": null or {"agent": "...", "action": "...", "reason": "..."},
"completion": "complete|escalate"}`;
  return { system, user };
}
