-- STAGED ONLY: do not apply to production before security review.
-- Existing encrypted Kept sync and FRIDAY reminder data are not accessed.
CREATE TABLE IF NOT EXISTS friday_auth_flows (
  state_hash TEXT PRIMARY KEY NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS friday_auth_flows_expiry ON friday_auth_flows(expires_at);

CREATE TABLE IF NOT EXISTS friday_auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  github_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS friday_auth_sessions_user ON friday_auth_sessions(github_id);
CREATE INDEX IF NOT EXISTS friday_auth_sessions_expiry ON friday_auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS friday_auth_limits (
  bucket_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts >= 1)
);
CREATE INDEX IF NOT EXISTS friday_auth_limits_window ON friday_auth_limits(window_start);
