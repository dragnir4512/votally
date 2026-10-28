-- 009 — Slugs réservés pour les pages de l'espace organisateur (évite qu'un concours masque une page du site)
INSERT INTO reserved_slugs (slug) VALUES
  ('connexion'),('inscription'),('espace'),('invitation'),('compte'),('mon-compte'),('tarifs'),('contact-us'),('faq')
ON CONFLICT DO NOTHING;
