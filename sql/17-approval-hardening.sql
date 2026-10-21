-- BuyWise migration 17: approval/scoring hardening (additive only, history preserved).
-- Approvals snapshot the facts they were reviewed against so stale packages
-- (request/offer/price/scoring/quantity/budget changes) fail closed at decision
-- and handoff time instead of silently authorizing a different purchase.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS scoring_version TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decision_at_package TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS offer_price NUMERIC(14,2);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS offer_currency CHAR(3);
-- Backfill is intentionally NOT applied to historical rows: NULL means
-- "unattributed history, predates snapshots" and endpoints treat it as
-- requiring a fresh package for any new handoff, never rewriting the past.
