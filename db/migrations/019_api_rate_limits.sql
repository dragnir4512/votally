-- 019 — Compteurs de limitation de débit partagés entre les instances API.
-- Une table PostgreSQL évite que chaque instance Node.js possède son propre compteur isolé.
CREATE TABLE api_rate_limits (
  rate_key text PRIMARY KEY,
  total_hits integer NOT NULL CHECK (total_hits > 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_rate_limits_reset_at_idx ON api_rate_limits (reset_at);
