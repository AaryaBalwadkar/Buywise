-- BuyWise migration 16: re-evaluation score provenance + pending-approval uniqueness.
-- Additive only. score_provenance records per-criterion source/weight/method
-- for every revised score (a 1.0 from one criterion stays explainable).
-- The partial unique index makes duplicate-approval protection hold under
-- concurrent retries, not just sequential checks.
ALTER TABLE reevaluations ADD COLUMN IF NOT EXISTS score_provenance JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_case
  ON approvals (procurement_id) WHERE status = 'PENDING_APPROVAL';
