-- BuyWise migration 09: multi-user authentication, roles, ownership, versions.
-- Additive only (one constraint relaxed: approvals one-per-case UNIQUE is
-- dropped so a new package can follow CHANGES_REQUESTED/REJECTED; duplicate
-- PENDING approvals are refused in code and history is preserved).
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9._-]{3,40}$'),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','requester','officer','approver','auditor')),
  approval_limit NUMERIC(14,2),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS admin_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_username TEXT,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE procurement_cases ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE procurement_cases ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decided_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decided_role TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS request_version INTEGER;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_procurement_id_key;
