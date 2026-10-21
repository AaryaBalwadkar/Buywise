-- BuyWise migration 10: allow the stale-decision audit event type.
-- Additive constraint change only; existing rows untouched.
ALTER TABLE approval_events DROP CONSTRAINT IF EXISTS approval_events_event_type_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_event_type_check CHECK (event_type = ANY (ARRAY['approval_created'::text, 'approval_viewed'::text, 'approval_approved'::text, 'approval_rejected'::text, 'approval_changes_requested'::text, 'approval_expired'::text, 'approval_cancelled'::text, 'demo_response_attached'::text, 'decision_rejected_stale'::text]));
