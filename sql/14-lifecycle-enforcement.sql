-- BuyWise migration 14: database-enforced lifecycle invariants.
-- The website enforces these in code (tools/_lib/lifecycle.js); this trigger
-- makes them hold for EVERY writer, including n8n workflows. The pair list
-- below must match TRANSITIONS in tools/_lib/lifecycle.js exactly — enforced
-- by web/test/db-consistency.test.mjs. Same-state writes are no-ops.
-- Also: at most one PENDING_APPROVAL per case (concurrency-safe duplicate guard).

CREATE OR REPLACE FUNCTION enforce_lifecycle_transition() RETURNS trigger AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  CASE OLD.status
    WHEN 'created' THEN allowed := NEW.status IN ('product_done','vendor_done','quality_done','compared','decided','partial','failed','needs_human_intervention','demo_negotiating','pending_approval');
    WHEN 'partial' THEN allowed := NEW.status IN ('product_done','vendor_done','quality_done','compared','decided','failed','needs_human_intervention','demo_negotiating','pending_approval');
    WHEN 'product_done' THEN allowed := NEW.status IN ('vendor_done','quality_done','compared','decided','failed','needs_human_intervention');
    WHEN 'vendor_done' THEN allowed := NEW.status IN ('quality_done','compared','decided','failed','needs_human_intervention');
    WHEN 'quality_done' THEN allowed := NEW.status IN ('compared','decided','failed','needs_human_intervention');
    WHEN 'compared' THEN allowed := NEW.status IN ('decided','failed','needs_human_intervention');
    WHEN 'decided' THEN allowed := NEW.status IN ('negotiating','demo_negotiating','pending_approval','compared','failed','needs_human_intervention');
    WHEN 'negotiating' THEN allowed := NEW.status IN ('reevaluated','pending_approval','failed','needs_human_intervention');
    WHEN 'demo_negotiating' THEN allowed := NEW.status IN ('demo_response_received','pending_approval','failed');
    WHEN 'demo_response_received' THEN allowed := NEW.status IN ('reevaluated','pending_approval','failed');
    WHEN 'reevaluated' THEN allowed := NEW.status IN ('pending_approval','demo_negotiating','failed');
    WHEN 'pending_approval' THEN allowed := NEW.status IN ('closed','changes_requested','failed');
    WHEN 'changes_requested' THEN allowed := NEW.status IN ('pending_approval','decided','compared','failed');
    WHEN 'failed' THEN allowed := NEW.status IN ('created','partial');
    WHEN 'needs_human_intervention' THEN allowed := NEW.status IN ('created','partial','failed');
    WHEN 'closed' THEN allowed := NEW.status IN ('purchase_handoff');
    WHEN 'purchase_handoff' THEN allowed := false;
    ELSE allowed := false;
  END CASE;
  IF NOT allowed THEN
    RAISE EXCEPTION 'illegal transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lifecycle ON procurement_cases;
CREATE TRIGGER trg_lifecycle BEFORE UPDATE OF status ON procurement_cases
  FOR EACH ROW EXECUTE FUNCTION enforce_lifecycle_transition();

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_case
  ON approvals (procurement_id) WHERE status = 'PENDING_APPROVAL';
