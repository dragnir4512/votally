-- 011 — Un concours privé doit toujours posséder un hash de mot de passe.
-- La règle est portée par PostgreSQL en défense en profondeur, même si une route API est contournée.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM contests
     WHERE visibility = 'private'
       AND access_password_hash IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration 011 interrompue : des concours privés sans mot de passe existent. Les examiner et les sécuriser avant de relancer la migration.';
  END IF;
END $$;

ALTER TABLE contests
  ADD CONSTRAINT contests_private_requires_password
  CHECK (visibility <> 'private' OR access_password_hash IS NOT NULL);
