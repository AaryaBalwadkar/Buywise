-- BuyWise migration 12: allow REAL email-flow negotiation event types.
-- Additive constraint change only; existing rows untouched.
ALTER TABLE negotiation_events DROP CONSTRAINT IF EXISTS negotiation_events_event_type_check;
ALTER TABLE negotiation_events ADD CONSTRAINT negotiation_events_event_type_check CHECK (event_type = ANY (ARRAY['evaluated_not_ready'::text, 'negotiation_created'::text, 'negotiation_proposed'::text, 'message_drafted'::text, 'human_review_required'::text, 'human_confirmed'::text, 'message_sent'::text, 'email_draft_created'::text, 'email_sent'::text, 'email_replies_polled'::text, 'vendor_response_received'::text, 'negotiation_failed'::text, 'demo_mode_selected'::text, 'demo_negotiation_created'::text, 'demo_response_received'::text]));
