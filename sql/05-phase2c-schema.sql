-- BuyWise Phase 2C migration. Additive only — no existing tables/rows touched.
-- Money: NUMERIC + currency; NULL savings mean UNAVAILABLE (currency mismatch or
-- unverified prices), never converted, never guessed. WAITING_FOR_VENDOR and
-- NOT_CREATED outcomes persist NO rows (like NOT_READY in Phase 2B).

-- 1. Final states: negotiating -> reevaluated -> pending_approval -> closed,
--    plus decided -> closed (explicit PROCEED business rule) and changes_requested.
ALTER TABLE procurement_cases DROP CONSTRAINT IF EXISTS procurement_cases_status_check;
ALTER TABLE procurement_cases ADD CONSTRAINT procurement_cases_status_check CHECK (status IN (
  'created','product_done','vendor_done','quality_done','compared',
  'decided','negotiating','reevaluated','pending_approval','changes_requested','closed',
  'needs_human_intervention','partial','failed'
));

-- 2. Execution log: final agent names
ALTER TABLE agent_executions DROP CONSTRAINT IF EXISTS agent_executions_agent_name_check;
ALTER TABLE agent_executions ADD CONSTRAINT agent_executions_agent_name_check CHECK (agent_name IN (
  'orchestrator','product_research','vendor_research','review_quality','comparison',
  'decision','negotiation','reevaluation','approval','scoring_engine','tool_gateway','state_manager'
));

-- 3. Re-evaluations (rows ONLY for verified vendor responses recomputed via scoring engine)
CREATE TABLE IF NOT EXISTS reevaluations (
  reevaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  negotiation_id UUID NOT NULL REFERENCES negotiations(negotiation_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  original_score NUMERIC(6,4),
  revised_score NUMERIC(6,4),
  score_delta NUMERIC(7,4),
  original_price NUMERIC(14,2),
  revised_price NUMERIC(14,2),
  currency CHAR(3),
  absolute_savings NUMERIC(14,2),
  percentage_savings NUMERIC(6,2),
  criteria_changed JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria_missing JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'REEVALUATED' CHECK (status IN ('REEVALUATED','PARTIAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, negotiation_id)
);

-- 4. Approvals (one open approval per procurement; human decision ONLY, never automatic)
CREATE TABLE IF NOT EXISTS approvals (
  approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  selected_product_id TEXT,
  selected_vendor_id TEXT,
  selected_offer_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CHANGES_REQUESTED','EXPIRED','CANCELLED')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  decision_reason TEXT,
  approval_package JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id)
);
DROP TRIGGER IF EXISTS trg_approvals_touch ON approvals;
CREATE TRIGGER trg_approvals_touch BEFORE UPDATE ON approvals
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 5. Immutable approval events (append-only; actor explicit, 'system' for automated steps)
CREATE TABLE IF NOT EXISTS approval_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID NOT NULL REFERENCES approvals(approval_id) ON DELETE CASCADE,
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'approval_created','approval_viewed','approval_approved','approval_rejected',
    'approval_changes_requested','approval_expired','approval_cancelled'
  )),
  actor TEXT NOT NULL,
  trace_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_events ON approval_events(approval_id, created_at);
