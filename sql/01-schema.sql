-- BuyWise Phase 1 schema (PostgreSQL 15). Source of truth. No mock data seeded.
-- Every external record carries source / source_url / retrieved_at / data_status / confidence.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Procurement case + state machine
CREATE TABLE IF NOT EXISTS procurement_cases (
  procurement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','product_done','vendor_done','needs_human_intervention','partial','failed')),
  requirement TEXT NOT NULL,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  budget NUMERIC(14,2),
  currency CHAR(3) DEFAULT 'USD',
  delivery_requirement TEXT,
  mandatory_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  preferred_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real products (one row per verified product)
CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'unavailable',
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL CHECK (source_url <> ''),
  retrieved_at TIMESTAMPTZ NOT NULL,
  data_status TEXT NOT NULL CHECK (data_status IN ('LIVE','PARTIAL','STALE','UNAVAILABLE')),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, source_url)
);

-- Real vendors (distinct sellers)
CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY,
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  vendor_url TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_status TEXT NOT NULL DEFAULT 'LIVE' CHECK (data_status IN ('LIVE','PARTIAL','STALE','UNAVAILABLE')),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real offers (product x vendor price points; price is time-sensitive)
CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  unit_price NUMERIC(14,2),
  currency CHAR(3),
  discount_pct NUMERIC(5,2),
  net_price NUMERIC(14,2),
  delivery_days TEXT NOT NULL DEFAULT 'unavailable',
  warranty_months TEXT NOT NULL DEFAULT 'unavailable',
  payment_terms TEXT NOT NULL DEFAULT 'unavailable',
  availability TEXT NOT NULL DEFAULT 'unavailable',
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  data_status TEXT NOT NULL CHECK (data_status IN ('LIVE','PARTIAL','STALE','UNAVAILABLE')),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_consistency CHECK (
    (unit_price IS NULL AND data_status IN ('PARTIAL','UNAVAILABLE'))
    OR (unit_price IS NOT NULL AND unit_price > 0 AND currency IS NOT NULL)
  ),
  UNIQUE (procurement_id, product_id, vendor_id, source_url)
);

-- Agent execution state (orchestrator-owned)
CREATE TABLE IF NOT EXISTS agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,
  agent_name TEXT NOT NULL CHECK (agent_name IN ('orchestrator','product_research','vendor_research','tool_gateway','state_manager')),
  status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed','retried','waiting_human')),
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  error_message TEXT,
  UNIQUE (trace_id, agent_name)
);

-- Immutable audit log (no API keys, no secrets — enforced by writer, not DB)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,
  agent_name TEXT NOT NULL,
  event TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_proc ON audit_log(procurement_id, created_at);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cases_touch ON procurement_cases;
CREATE TRIGGER trg_cases_touch BEFORE UPDATE ON procurement_cases
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
