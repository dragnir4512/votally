-- 008 — Verrouille max_choices_per_vote après le lancement
-- Raison : une commande en attente de paiement a été validée avec l'ancien maximum ; le baisser après coup
-- ferait échouer la confirmation APRÈS que le votant a payé. (Migration 003 inchangée : on ne modifie jamais une migration appliquée.)

CREATE OR REPLACE FUNCTION contests_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('draft','active'), ('draft','archived'),
         ('active','paused'), ('active','closed'),
         ('paused','active'), ('paused','closed'),
         ('closed','archived')) THEN
      RAISE EXCEPTION 'Transition interdite : % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'active' THEN
      IF NEW.rules IS NULL OR btrim(NEW.rules) = '' THEN
        RAISE EXCEPTION 'Le règlement du concours est obligatoire avant activation' USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(*) FROM candidates WHERE contest_id = NEW.id AND is_active) < 2 THEN
        RAISE EXCEPTION 'Au moins 2 candidats actifs sont requis avant activation' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.ends_at IS NOT NULL AND NEW.ends_at <= now() THEN
        RAISE EXCEPTION 'La date de fin est déjà passée' USING ERRCODE = 'check_violation';
      END IF;
      NEW.activated_at := now();
    END IF;

    IF NEW.status = 'closed' THEN NEW.closed_at := now(); END IF;
  END IF;

  -- REQ-CONTEST-011 : après le lancement, on ne change plus le prix, le type de vote, le slug ni le propriétaire
  IF OLD.status <> 'draft' AND (
       NEW.vote_type      IS DISTINCT FROM OLD.vote_type
    OR NEW.vote_price_xaf IS DISTINCT FROM OLD.vote_price_xaf
    OR NEW.slug           IS DISTINCT FROM OLD.slug
    OR NEW.owner_id       IS DISTINCT FROM OLD.owner_id
    OR NEW.max_choices_per_vote IS DISTINCT FROM OLD.max_choices_per_vote) THEN
    RAISE EXCEPTION 'Prix, type de vote, nombre de choix, slug et propriétaire sont verrouillés après le lancement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
