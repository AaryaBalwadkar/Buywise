-- BuyWise Phase 2A migration. Additive only — no existing tables/rows touched.
-- NULL in rating/count/score columns means "unavailable" (never 0, never guessed).

-- 1. Extend state machine: quality_done -> compared (keep all Phase 1 states)
ALTER TABLE procurement_cases DROP CONSTRAINT IF EXISTS procurement_cases_status_check;
ALTER TABLE procurement_cases ADD CONSTRAINT procurement_cases_status_check CHECK (status IN (
  'created','product_done','vendor_done','quality_done','compared',
  'needs_human_intervention','partial','failed'
));

-- 2. Per-procurement scoring configuration (weights user-overridable, never in LLM prompts)
CREATE TABLE IF NOT EXISTS scoring_configs (
  procurement_id UUID PRIMARY KEY REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  spec_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_quality_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_scoring_touch ON scoring_configs;
CREATE TRIGGER trg_scoring_touch BEFORE UPDATE ON scoring_configs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 3. Structured quality evidence (one row per product; agent gathers, never decides)
CREATE TABLE IF NOT EXISTS quality_evaluations (
  quality_evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  source_quality TEXT NOT NULL CHECK (source_quality IN ('HIGH','MEDIUM','LOW')),
  source_quality_score NUMERIC(3,2) NOT NULL CHECK (source_quality_score >= 0 AND source_quality_score <= 1),
  specification_completeness NUMERIC(4,3) NOT NULL CHECK (specification_completeness >= 0 AND specification_completeness <= 1),
  spec_fields_total INTEGER NOT NULL CHECK (spec_fields_total >= 0),
  spec_fields_verified INTEGER NOT NULL CHECK (spec_fields_verified >= 0),
  review_rating NUMERIC(3,2),
  review_scale NUMERIC(4,1),
  review_count INTEGER CHECK (review_count IS NULL OR review_count >= 0),
  review_evidence TEXT NOT NULL DEFAULT 'unavailable',
  quality_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_confidence NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (quality_confidence >= 0 AND quality_confidence <= 1),
  source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_status TEXT NOT NULL CHECK (data_status IN ('LIVE','PARTIAL','STALE','UNAVAILABLE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, product_id)
);

-- 4. Deterministic comparison output (ranking from scoring engine only, never LLM)
CREATE TABLE IF NOT EXISTS comparisons (
  comparison_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id UUID NOT NULL REFERENCES procurement_cases(procurement_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  overall_score NUMERIC(6,4),
  criteria_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  criteria_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria_missing JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_weight_total NUMERIC(6,4) NOT NULL DEFAULT 0,
  budget_compliance TEXT NOT NULL DEFAULT 'unavailable',
  source_quality NUMERIC(3,2),
  specification_completeness NUMERIC(4,3),
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procurement_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_comparisons_rank ON comparisons(procurement_id, rank);
