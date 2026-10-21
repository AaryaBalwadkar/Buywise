-- BuyWise migration 11: real vendor-email outbox + verified inbound messages.
-- Additive only. Outbox rows track draft→send per proposal (nothing sends
-- without an explicit human confirm, enforced in code). vendor_messages are
-- REAL Sugar-free vendor evidence (vendor_response_verified=true), strictly
-- separate from hand-entered demo_responses (verified=false).
CREATE TABLE IF NOT EXISTS email_outbox (
  outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  negotiation_id UUID NOT NULL REFERENCES negotiations(negotiation_id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','FAILED')),
  gmail_draft_id TEXT,
  gmail_message_id TEXT,
  thread_id TEXT,
  created_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  sent_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_nego ON email_outbox(negotiation_id);
CREATE TABLE IF NOT EXISTS vendor_messages (
  vendor_message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  negotiation_id UUID REFERENCES negotiations(negotiation_id) ON DELETE SET NULL,
  offer_id TEXT,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  thread_id TEXT,
  gmail_message_id TEXT NOT NULL UNIQUE,
  received_at TIMESTAMPTZ,
  vendor_response_verified BOOLEAN NOT NULL DEFAULT true,
  transcribed_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_messages_nego ON vendor_messages(negotiation_id);
