-- 018 — Sessions serveur révocables pour les comptes créateurs et administrateurs.
-- Les visiteurs et votants publics ne possèdent toujours aucun compte VOTALLY.
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash bytea NOT NULL,
  user_agent text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);

CREATE UNIQUE INDEX user_sessions_refresh_token_hash_uq
  ON user_sessions (refresh_token_hash);

CREATE INDEX user_sessions_active_by_user_idx
  ON user_sessions (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
