-- BuyWise migration 07: inter-agent coordination messages (CA3 trace evidence).
-- Additive only. Agents exchange task_assignment / evidence_report /
-- revision_request / decision / escalation / handoff messages with recorded
-- reasons; revision loops are bounded by convention (see tools/_lib/coordination.js).
CREATE TABLE IF NOT EXISTS agent_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES agent_messages(message_id) ON DELETE SET NULL,
  trace_id UUID NOT NULL,
  sender_agent TEXT NOT NULL,
  recipient_agent TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN
    ('task_assignment','evidence_report','revision_request','decision','escalation','handoff','review_request')),
  objective TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  evidence_refs JSONB NOT NULL DEFAULT '[]',
  requested_action TEXT,
  reason TEXT NOT NULL DEFAULT '',
  tool_calls JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','acknowledged','completed','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  CONSTRAINT agent_messages_agents_check CHECK (
    sender_agent IN ('orchestrator','product_research','vendor_research','review_quality','comparison','decision','negotiation','reevaluation','approval','scoring_engine','tool_gateway','state_manager','human') AND
    recipient_agent IN ('orchestrator','product_research','vendor_research','review_quality','comparison','decision','negotiation','reevaluation','approval','scoring_engine','tool_gateway','state_manager','human'))
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_proc ON agent_messages(procurement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_parent ON agent_messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
