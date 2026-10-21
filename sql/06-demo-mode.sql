-- BuyWise DEMO MODE migration. Additive only — REAL flow untouched, no rows modified.
-- Demo = explicitly human-entered local responses (DEMO_HUMAN_ENTERED), NEVER
-- presented as vendor activity. REAL mode still blocks without verified channels.

-- 1. Mode on cases (default REAL; DEMO only by explicit switch, audited)
ALTER TABLE procurement_cases ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'REAL'
  CHECK (mode IN ('REAL', 'DEMO'));
ALTER TABLE procurement_cases DROP CONSTRAINT IF EXISTS procurement_cases_status_check;
ALTER TABLE procurement_cases ADD CONSTRAINT procurement_cases_status_check CHECK (status IN (
  'created','product_done','vendor_done','quality_done','compared',
  'decided','negotiating','demo_negotiating','demo_response_received',
  'reevaluated','pending_approval','changes_requested','closed',
  'needs_human_intervention','partial','failed'
));

-- 2. Negotiations: mode + demo lifecycle statuses (REAL statuses unchanged)
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'REAL'
  CHECK (mode IN ('REAL', 'DEMO'));
ALTER TABLE negotiations DROP CONSTRAINT IF EXISTS negotiations_status_check;
ALTER TABLE negotiations ADD CONSTRAINT negotiations_status_check CHECK (status IN (
  'NOT_READY','READY_FOR_HUMAN_REVIEW','READY_TO_SEND','SENT','WAITING_FOR_VENDOR',
  'VENDOR_RESPONSE_RECEIVED','DEMO_READY_FOR_RESPONSE','DEMO_RESPONSE_RECEIVED','FAILED'
));

-- 3. Re-evaluations + approvals carry mode for provenance
ALTER TABLE reevaluations ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'REAL'
  CHECK (mode IN ('REAL', 'DEMO'));
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'REAL'
  CHECK (mode IN ('REAL', 'DEMO'));

-- 4. Human-entered demo responses (explicitly NOT vendor responses)
CREATE TABLE IF NOT EXISTS demo_responses (
  demo_response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  negotiation_id UUID REFERENCES negotiations(negotiation_id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL,
  revised_price NUMERIC(14,2) NOT NULL CHECK (revised_price > 0),
  currency CHAR(3) NOT NULL,
  delivery_days TEXT NOT NULL DEFAULT 'unavailable',
  warranty TEXT NOT NULL DEFAULT 'unavailable',
  payment_terms TEXT NOT NULL DEFAULT 'unavailable',
  notes TEXT NOT NULL DEFAULT '',
  response_mode TEXT NOT NULL DEFAULT 'DEMO_HUMAN_ENTERED' CHECK (response_mode = 'DEMO_HUMAN_ENTERED'),
  source TEXT NOT NULL DEFAULT 'LOCAL_DEMO_INPUT' CHECK (source = 'LOCAL_DEMO_INPUT'),
  vendor_response_verified BOOLEAN NOT NULL DEFAULT false,
  entered_by TEXT NOT NULL DEFAULT 'HUMAN' CHECK (entered_by = 'HUMAN'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Demo events in the immutable negotiation trail
ALTER TABLE negotiation_events DROP CONSTRAINT IF EXISTS negotiation_events_event_type_check;
ALTER TABLE negotiation_events ADD CONSTRAINT negotiation_events_event_type_check CHECK (event_type IN (
  'evaluated_not_ready','negotiation_created','message_drafted','human_review_required',
  'human_confirmed','message_sent','vendor_response_received','negotiation_failed',
  'demo_mode_selected','demo_negotiation_created','demo_response_received'
));

-- 6. Approval events: demo receipt marker (human decision events already exist)
ALTER TABLE approval_events DROP CONSTRAINT IF EXISTS approval_events_event_type_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_event_type_check CHECK (event_type IN (
  'approval_created','approval_viewed','approval_approved','approval_rejected',
  'approval_changes_requested','approval_expired','approval_cancelled','demo_response_attached'
));
