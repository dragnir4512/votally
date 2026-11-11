-- 013 — Autoriser le logo de concours dans le registre des téléversements.
-- Le endpoint POST /contests/:id/logo stocke déjà les logos avec purpose = 'contest_logo'.
-- La contrainte 010 ne listait pas cette valeur et faisait échouer chaque insertion.
ALTER TABLE uploads
  DROP CONSTRAINT IF EXISTS uploads_purpose_check;

ALTER TABLE uploads
  ADD CONSTRAINT uploads_purpose_check
  CHECK (purpose IN ('candidate_image', 'contest_banner', 'contest_logo', 'kyc_id', 'kyc_org'));
