-- BuyWise migration 08: per-message reasoning-mode labels (CA3 LLM honesty).
-- Additive only. Every coordination message records whether an LLM advisory
-- contributed (LLM_REASONING + model name) or the deterministic fallback ran.
ALTER TABLE agent_messages
  ADD COLUMN IF NOT EXISTS reasoning_mode TEXT NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK'
    CHECK (reasoning_mode IN ('LLM_REASONING', 'DETERMINISTIC_FALLBACK')),
  ADD COLUMN IF NOT EXISTS llm_model TEXT;
