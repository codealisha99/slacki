CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  slack_user_id text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  encrypted_access_token text NOT NULL,
  token_iv text NOT NULL,
  token_tag text NOT NULL,
  encrypted_refresh_token text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  is_workspace_admin boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  approved_by text REFERENCES app_users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executing', 'rejected', 'executed', 'failed')),
  requires_admin boolean NOT NULL DEFAULT false,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS action_approvals_queue_idx
  ON action_approvals (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS web_sessions_expiry_idx ON web_sessions (expires_at);
