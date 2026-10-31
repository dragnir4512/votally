-- 010 — Fichiers téléversés : images publiques (candidats, bannières) et pièces KYC privées
-- Le suivi en base permet de contrôler QUI possède quel fichier et de ne servir publiquement que les images publiques.

CREATE TABLE uploads (
  key            text PRIMARY KEY,                      -- nom aléatoire (32 hex + extension), jamais deviné ni fourni par le client
  owner_user_id  uuid NOT NULL REFERENCES users(id),
  visibility     text NOT NULL CHECK (visibility IN ('public','private')),
  purpose        text NOT NULL CHECK (purpose IN ('candidate_image','contest_banner','kyc_id','kyc_org')),
  content_type   text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uploads_kyc_is_private CHECK ((purpose IN ('kyc_id','kyc_org')) = (visibility = 'private')),
  CONSTRAINT uploads_key_format CHECK (key ~ '^[a-f0-9]{32}\.(webp|jpg|png|pdf)$')
);
CREATE INDEX idx_uploads_owner ON uploads (owner_user_id, purpose, created_at DESC);
CREATE TRIGGER trg_uploads_immutable BEFORE UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION block_mutation();
