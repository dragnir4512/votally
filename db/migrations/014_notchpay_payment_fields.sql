-- 014 — Champs nécessaires à l'intégration Notch Pay
-- Ajout des informations nécessaires au paiement hébergé.

ALTER TABLE payments
  ADD COLUMN payer_email text,
  ADD COLUMN authorization_url text;

COMMENT ON COLUMN payments.payer_email IS
  'Adresse email du payeur transmise à l’agrégateur de paiement.';

COMMENT ON COLUMN payments.authorization_url IS
  'URL de paiement hébergé retournée par l’agrégateur.';