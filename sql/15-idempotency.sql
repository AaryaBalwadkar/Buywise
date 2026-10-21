-- BuyWise migration 15: intake idempotency key (additive only).
-- Lets retried intake submissions converge on one case instead of creating
-- duplicates when the n8n webhook is slow to answer. The website sends
-- client_request_id; the state-manager persists it (90-util-state-manager).
ALTER TABLE procurement_cases ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_cases_client_request_uidx
  ON procurement_cases (client_request_id) WHERE client_request_id IS NOT NULL;
