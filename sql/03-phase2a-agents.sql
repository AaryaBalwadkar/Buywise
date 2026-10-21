-- BuyWise Phase 2A follow-up: allow new agent/utility names in execution log.
ALTER TABLE agent_executions DROP CONSTRAINT IF EXISTS agent_executions_agent_name_check;
ALTER TABLE agent_executions ADD CONSTRAINT agent_executions_agent_name_check CHECK (agent_name IN (
  'orchestrator','product_research','vendor_research','review_quality','comparison',
  'scoring_engine','tool_gateway','state_manager'
));
