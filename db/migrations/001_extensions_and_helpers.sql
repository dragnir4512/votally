-- 001 — Extensions, fonctions utilitaires, paramètres plateforme
-- VOTALLY v1.1 — PostgreSQL 14+ (testé sur 16)

CREATE EXTENSION IF NOT EXISTS citext;   -- emails et slugs insensibles à la casse

-- Met à jour updated_at automatiquement
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Interdit toute modification / suppression (tables immuables : ledger, audit, historique)
CREATE FUNCTION block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est immuable (% interdit). Corriger par écriture inverse.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Paramètres globaux modifiables par l'administrateur (commission, seuils, délais)
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_platform_settings_updated BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION setting_int(p_key text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT (value #>> '{}')::bigint FROM platform_settings WHERE key = p_key
$$;

-- Slugs interdits comme sous-domaines (REQ-CONTEST-003)
CREATE TABLE reserved_slugs (
  slug citext PRIMARY KEY
);
