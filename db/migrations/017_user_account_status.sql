-- 017 — Cycle de vie des comptes utilisateurs (sans rôle votant)
ALTER TABLE users
  ADD COLUMN account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'disabled')),
  ADD COLUMN account_status_reason text,
  ADD COLUMN account_status_changed_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX idx_users_account_status
  ON users (account_status, created_at DESC)
  WHERE deleted_at IS NULL;
