-- 020 — OTP de vérification des coordonnées secondaires
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signup','login','password_reset','free_vote','payout','channel','contact'));
