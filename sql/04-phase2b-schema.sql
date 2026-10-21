-- BuyWise Phase 2B migration. Additive only — no existing tables/rows touched.
-- Money fields: NUMERIC + currency; NULL target/price fields mean "unavailable", never guessed.
-- NOT_READY outcomes persist NO negotiation row (vendor_id/offer_id are NOT NULL);
-- the evaluation itself is recorded immutably in negotiation_events.

-- 1. Valid Phase 2B transitions: compared -> decided -> negotiating (2C states excluded)
ALTER TABLE procurement_cases DROP CONSTRAINT IF EXISTS procurement_cases_status_check;
ALTER TABLE procurement_cases ADD CONSTRAINT procurement_cases_status_check CHECK (status IN (
  'created','product_done','vendor_done','quality_done','compared',
  'decided','negotiating',
  'needs_human_intervention','partial','failed'
));

-- 2. Execution log: new agent names
ALTER TABLE agent_executions DROP CONSTRAINT IF EXISTS agent_executions_agent_name_check;
ALTER TABLE agent_executions ADD CONSTRAINT agent_executions_agent_name_check CHECK (agent_name IN (
  'orchestrator','product_research','vendor_research','review_quality','comparison',
  'decision','negotiation','scoring_engine','tool_gateway','state_manager'
));

-- 3. Decisions (one row per procurement decision; scores stay in comparisons)
CREATE TABLE IF NOT EXISTS decisions (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT,
  comparison_id UUID REFERENCES comparisons(comparison_id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('PROCEED','NEGOTIATE','INSUFFICIENT_DATA')),
  decision_reason TEXT NOT NULL,
  blocking_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria_missing JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id)
);

-- 4. Negotiations (rows ONLY for eligible real vendor+offer pairs; dupes blocked at DB level)
CREATE TABLE IF NOT EXISTS negotiations (
  negotiation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(offer_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'READY_FOR_HUMAN_REVIEW'
    CHECK (status IN ('NOT_READY','READY_FOR_HUMAN_REVIEW','READY_TO_SEND','SENT','WAITING_FOR_VENDOR','VENDOR_RESPONSE_RECEIVED','FAILED')),
  current_price NUMERIC(14,2) NOT NULL CHECK (current_price > 0),
  currency CHAR(3) NOT NULL,
  target_price NUMERIC(14,2) CHECK (target_price IS NULL OR target_price > 0),
  requested_discount_percent NUMERIC(5,2) CHECK (requested_discount_percent IS NULL OR (requested_discount_percent >= 0 AND requested_discount_percent <= 100)),
  requested_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_channel JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_confirmation BOOLEAN NOT NULL DEFAULT false,
  do_not_send BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, offer_id)
);
DROP TRIGGER IF EXISTS trg_negotiations_touch ON negotiations;
CREATE TRIGGER trg_negotiations_touch BEFORE UPDATE ON negotiations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 5. Drafted messages (facts-only drafts for eligible negotiations; sending is Phase 2C)
CREATE TABLE IF NOT EXISTS negotiation_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID NOT NULL REFERENCES negotiations(negotiation_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  facts_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Immutable negotiation event trail (negotiation_id NULLABLE so NOT_READY evaluations are recorded without fake rows)
CREATE TABLE IF NOT EXISTS negotiation_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID REFERENCES negotiations(negotiation_id) ON DELETE CASCADE,
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'evaluated_not_ready','negotiation_created','message_drafted','human_review_required',
    'human_confirmed','message_sent','vendor_response_received','negotiation_failed'
  )),
  trace_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nevents_proc ON negotiation_events(procurement_id, created_at);
