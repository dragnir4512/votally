-- 020 — OTP de vérification des coordonnées secondaires
-- Préserve les motifs existants et ajoute uniquement le nouveau motif "contact".
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signup','login','password_reset','free_vote','payout','contact'));
