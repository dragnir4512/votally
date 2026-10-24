-- 007 — Données de référence (paramètres plateforme, slugs réservés)

INSERT INTO platform_settings (key, value, description) VALUES
  ('commission_rate_bps',  '800',  'Commission VOTALLY en points de base (800 = 8 %)'),
  ('min_vote_price_xaf',   '100',  'Prix minimum d''un vote payant (FCFA)'),
  ('min_payout_xaf',       '5000', 'Montant minimum d''un retrait (FCFA)'),
  ('payout_delay_hours',   '72',   'Délai de sécurité entre la clôture et le premier retrait'),
  ('paid_grace_minutes',   '15',   'Délai pendant lequel un paiement confirmé après la clôture compte encore'),
  ('order_expiry_minutes', '15',   'Durée de validité d''une commande de votes en attente de paiement'),
  ('otp_ttl_minutes',      '10',   'Durée de validité d''un code SMS')
ON CONFLICT (key) DO NOTHING;

INSERT INTO reserved_slugs (slug) VALUES
  ('www'),('api'),('admin'),('app'),('mail'),('email'),('smtp'),('ftp'),('cdn'),('static'),('assets'),('img'),('images'),
  ('docs'),('help'),('support'),('status'),('blog'),('dashboard'),('login'),('signup'),('register'),('auth'),('oauth'),
  ('billing'),('pay'),('payments'),('webhook'),('webhooks'),('staging'),('dev'),('test'),('demo'),('sandbox'),
  ('votally'),('vote'),('votes'),('root'),('security'),('abuse'),('noreply'),('no-reply'),('postmaster'),
  ('careers'),('about'),('contact'),('terms'),('privacy'),('legal'),('cgu'),('console'),('portal'),('secure'),
  ('ns1'),('ns2'),('mx'),('imap'),('pop'),('wiki'),('shop'),('store'),('news'),('press')
ON CONFLICT DO NOTHING;

-- Commission courante (lue par l'API lors de la création d'une commande payante)
CREATE FUNCTION current_commission_bps() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(setting_int('commission_rate_bps'), 800)::integer
$$;
