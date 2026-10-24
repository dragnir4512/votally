-- 002 — Utilisateurs, OTP, KYC créateurs (REQ-AUTH, REQ-KYC)

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext UNIQUE,
  phone                 text UNIQUE,                       -- E.164, ex. +237691234567
  password_hash         text,                              -- Argon2id / bcrypt, NULL si OAuth seul
  full_name             text,
  role                  text NOT NULL DEFAULT 'creator' CHECK (role IN ('creator','admin')),
  locale                text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','en')),
  email_verified_at     timestamptz,
  phone_verified_at     timestamptz,
  oauth_google_id       text UNIQUE,
  totp_secret_enc       bytea,                             -- secret TOTP chiffré côté application
  kyc_status            text NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','approved','rejected')),
  terms_version         text,                              -- version des CGU acceptées (loi 2024/017 : consentement horodaté)
  terms_accepted_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT users_contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL OR oauth_google_id IS NOT NULL),
  CONSTRAINT users_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Codes à usage unique (inscription, reset, vote gratuit, retrait). Jamais stockés en clair.
CREATE TABLE otp_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       text NOT NULL CHECK (purpose IN ('signup','login','password_reset','free_vote','payout')),
  channel       text NOT NULL CHECK (channel IN ('sms','email')),
  target_hash   bytea NOT NULL,                            -- hash (avec poivre) du téléphone ou de l'email
  code_hash     bytea NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX idx_otp_lookup ON otp_codes (purpose, target_hash, created_at DESC);

-- Dossier KYC (REQ-KYC) : requis avant le premier retrait uniquement
CREATE TABLE creator_kyc (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  type                text NOT NULL CHECK (type IN ('individual','organization')),
  legal_name          text NOT NULL,
  id_document_type    text NOT NULL CHECK (id_document_type IN ('cni','passport')),
  id_document_key     text NOT NULL,                       -- clé de stockage chiffré, accès restreint
  organization_docs   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- récépissé, RCCM, NIU (clés de stockage)
  niu                 text,
  payout_method       text NOT NULL CHECK (payout_method IN ('mtn_momo','orange_money')),
  payout_phone        text NOT NULL CHECK (payout_phone ~ '^\+[1-9][0-9]{7,14}$'),
  payout_account_name text NOT NULL,                       -- doit correspondre à legal_name (contrôle à la validation)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  rejection_reason    text,
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_rejection_needs_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT kyc_org_needs_docs CHECK (type <> 'organization' OR organization_docs <> '{}'::jsonb)
);
-- Un seul dossier actif (en attente ou validé) par utilisateur
CREATE UNIQUE INDEX uq_kyc_one_active ON creator_kyc (user_id) WHERE status IN ('pending','approved');

-- Synchronise users.kyc_status avec le dossier
CREATE FUNCTION sync_user_kyc_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET kyc_status = CASE NEW.status
      WHEN 'pending' THEN 'pending' WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected'
      ELSE kyc_status END
  WHERE id = NEW.user_id AND NEW.status <> 'superseded';
  RETURN NEW;
END $$;
CREATE TRIGGER trg_kyc_sync AFTER INSERT OR UPDATE OF status ON creator_kyc
  FOR EACH ROW EXECUTE FUNCTION sync_user_kyc_status();
