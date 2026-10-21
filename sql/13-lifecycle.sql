-- BuyWise migration 13: lifecycle hardening (additive + backfill of facts).
-- 1. Decision outcomes: NO_ELIGIBLE_OFFERS, RESEARCH_REQUIRED (deterministic mapping in tools/_lib/decision.js).
-- 2. Scoring rules version columns (engine version pinned in tools/_lib/scoring.js).
-- 3. eligibility table: PASS/FAIL/UNKNOWN per product x mandatory requirement + evidence.
-- 4. purchase_handoff case status (recorded after REAL APPROVED closure).
-- 5. Backfill request_version=1 on legacy approvals whose case is still v1
--    (factually true: versions started at 1; decided_by stays NULL = unattributed history).
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_decision_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_decision_check CHECK (decision = ANY (ARRAY['PROCEED'::text, 'NEGOTIATE'::text, 'INSUFFICIENT_DATA'::text, 'NO_ELIGIBLE_OFFERS'::text, 'RESEARCH_REQUIRED'::text]));

ALTER TABLE scoring_configs ADD COLUMN IF NOT EXISTS rules_version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS rules_version TEXT NOT NULL DEFAULT '1.0.0';

CREATE TABLE IF NOT EXISTS eligibility (
  eligibility_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  requirement TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'UNKNOWN')),
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, product_id, requirement)
);
CREATE INDEX IF NOT EXISTS idx_eligibility_proc ON eligibility(procurement_id);

ALTER TABLE procurement_cases DROP CONSTRAINT IF EXISTS procurement_cases_status_check;
ALTER TABLE procurement_cases ADD CONSTRAINT procurement_cases_status_check CHECK (status = ANY (ARRAY['created'::text, 'product_done'::text, 'vendor_done'::text, 'quality_done'::text, 'compared'::text, 'decided'::text, 'negotiating'::text, 'demo_negotiating'::text, 'demo_response_received'::text, 'reevaluated'::text, 'pending_approval'::text, 'changes_requested'::text, 'closed'::text, 'needs_human_intervention'::text, 'partial'::text, 'failed'::text, 'purchase_handoff'::text]));

UPDATE approvals SET request_version = 1
WHERE request_version IS NULL AND (SELECT version FROM procurement_cases WHERE procurement_id = approvals.procurement_id) = 1;
