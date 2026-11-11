-- 012 — Contenu éditorial et identité du mini-site concours
-- Données éditoriales extensibles (slogan, concept, objectifs, lieu, éligibilité,
-- coordonnées et liens sociaux) sans multiplier les colonnes au fil des modules.
ALTER TABLE contests
  ADD COLUMN site_content jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE contests
  ADD CONSTRAINT contests_site_content_object
  CHECK (jsonb_typeof(site_content) = 'object');
