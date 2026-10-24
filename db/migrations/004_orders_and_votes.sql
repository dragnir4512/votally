-- 004 — Commandes de votes, votes, compteurs, résultats (REQ-VOTE, REQ-FRAUD, REQ-RES)
--
-- Modèle : une COMMANDE (vote_orders) regroupe les votes d'un votant ; ses VOTES (votes) répartissent
-- la quantité achetée entre un ou plusieurs candidats. Un vote n'existe que si la commande est confirmée.
-- Montants en FCFA entiers. Les numéros de téléphone ne sont stockés qu'en haché (+ masqué + chiffré optionnel).

CREATE TABLE vote_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            text NOT NULL UNIQUE
                         DEFAULT 'VT-' || upper(replace(substr(gen_random_uuid()::text, 1, 13), '-', '')),
  contest_id           uuid NOT NULL REFERENCES contests(id),
  kind                 text NOT NULL CHECK (kind IN ('free','paid')),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','failed','expired','cancelled','refunded')),
  votes_count          integer NOT NULL CHECK (votes_count > 0),
  pack_id              uuid,
  unit_price_xaf       integer NOT NULL DEFAULT 0 CHECK (unit_price_xaf >= 0),
  subtotal_xaf         integer NOT NULL DEFAULT 0 CHECK (subtotal_xaf >= 0),   -- prix des votes, hors frais
  fee_xaf              integer NOT NULL DEFAULT 0 CHECK (fee_xaf >= 0),        -- frais de transaction payés par le votant
  total_xaf            integer NOT NULL DEFAULT 0 CHECK (total_xaf >= 0),
  commission_rate_bps  smallint NOT NULL DEFAULT 0 CHECK (commission_rate_bps BETWEEN 0 AND 10000),  -- 800 = 8 %
  commission_xaf       integer NOT NULL DEFAULT 0 CHECK (commission_xaf >= 0),
  creator_net_xaf      integer NOT NULL DEFAULT 0 CHECK (creator_net_xaf >= 0),
  voter_phone_hash     bytea,                      -- SHA-256(téléphone + poivre) : détection de doublons
  voter_phone_masked   text,                       -- ex. +237 6** *** *56
  voter_phone_enc      bytea,                      -- chiffré applicativement, uniquement si un reçu SMS est demandé
  device_hash          bytea,
  ip                   inet,
  user_agent           text,
  country_code         char(2),
  locale               text CHECK (locale IN ('fr','en')),
  idempotency_key      text UNIQUE,
  expires_at           timestamptz NOT NULL,
  confirmed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, contest_id),
  FOREIGN KEY (pack_id, contest_id) REFERENCES vote_packs (id, contest_id),
  CONSTRAINT orders_amounts CHECK (
    (kind = 'free' AND subtotal_xaf = 0 AND fee_xaf = 0 AND total_xaf = 0
       AND commission_xaf = 0 AND creator_net_xaf = 0 AND voter_phone_hash IS NOT NULL)
    OR
    (kind = 'paid' AND subtotal_xaf > 0
       AND total_xaf = subtotal_xaf + fee_xaf
       AND commission_xaf = ((subtotal_xaf::bigint * commission_rate_bps + 5000) / 10000)   -- arrondi au FCFA le plus proche
       AND creator_net_xaf = subtotal_xaf - commission_xaf)
  )
);
CREATE INDEX idx_orders_contest_status ON vote_orders (contest_id, status);
CREATE INDEX idx_orders_phone ON vote_orders (contest_id, voter_phone_hash, created_at) WHERE voter_phone_hash IS NOT NULL;
CREATE INDEX idx_orders_pending_expiry ON vote_orders (expires_at) WHERE status = 'pending';
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON vote_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Règles à la création : concours ouvert, type compatible, prix cohérent, quota de votes gratuits
CREATE FUNCTION vote_orders_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c        contests%ROWTYPE;
  p        vote_packs%ROWTYPE;
  v_used   bigint;
BEGIN
  SELECT * INTO c FROM contests WHERE id = NEW.contest_id;

  IF c.status <> 'active'
     OR (c.starts_at IS NOT NULL AND now() < c.starts_at)
     OR (c.ends_at   IS NOT NULL AND now() > c.ends_at) THEN
    RAISE EXCEPTION 'Le concours n''accepte pas de votes actuellement' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'free' THEN
    IF c.vote_type NOT IN ('free','mixed') THEN
      RAISE EXCEPTION 'Ce concours n''accepte pas de votes gratuits' USING ERRCODE = 'check_violation';
    END IF;
    -- Sérialise les demandes simultanées du même numéro, puis applique le quota par période
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contest_id::text || encode(NEW.voter_phone_hash, 'hex'), 0));
    SELECT COALESCE(sum(votes_count), 0) INTO v_used
      FROM vote_orders
     WHERE contest_id = NEW.contest_id AND kind = 'free'
       AND voter_phone_hash = NEW.voter_phone_hash
       AND status IN ('pending','confirmed')
       AND created_at > now() - make_interval(hours => c.free_vote_period_hours);
    IF v_used + NEW.votes_count > c.free_votes_per_period THEN
      RAISE EXCEPTION 'Quota de votes gratuits atteint pour ce numéro' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF c.vote_type NOT IN ('paid','mixed') THEN
      RAISE EXCEPTION 'Ce concours n''accepte pas de votes payants' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.unit_price_xaf <> c.vote_price_xaf THEN
      RAISE EXCEPTION 'Prix unitaire (%) différent du prix du concours (%)', NEW.unit_price_xaf, c.vote_price_xaf
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.pack_id IS NULL THEN
      IF NEW.subtotal_xaf <> NEW.votes_count * c.vote_price_xaf THEN
        RAISE EXCEPTION 'Sous-total incohérent avec le nombre de votes' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      SELECT * INTO p FROM vote_packs WHERE id = NEW.pack_id AND contest_id = NEW.contest_id AND is_active;
      IF NOT FOUND OR p.votes_count <> NEW.votes_count OR p.price_xaf <> NEW.subtotal_xaf THEN
        RAISE EXCEPTION 'Pack de votes invalide ou incohérent' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_before_insert BEFORE INSERT ON vote_orders
  FOR EACH ROW EXECUTE FUNCTION vote_orders_before_insert();

-- Cycle de vie d'une commande ; montants et contexte figés après création
CREATE FUNCTION vote_orders_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contest_id <> OLD.contest_id OR NEW.kind <> OLD.kind OR NEW.votes_count <> OLD.votes_count
     OR NEW.subtotal_xaf <> OLD.subtotal_xaf OR NEW.fee_xaf <> OLD.fee_xaf OR NEW.total_xaf <> OLD.total_xaf
     OR NEW.commission_xaf <> OLD.commission_xaf OR NEW.commission_rate_bps <> OLD.commission_rate_bps
     OR NEW.creator_net_xaf <> OLD.creator_net_xaf OR NEW.unit_price_xaf <> OLD.unit_price_xaf
     OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
     OR NEW.voter_phone_hash IS DISTINCT FROM OLD.voter_phone_hash THEN
    RAISE EXCEPTION 'Les montants et le contexte d''une commande ne sont pas modifiables' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('pending','confirmed'), ('pending','failed'), ('pending','expired'), ('pending','cancelled'),
         ('expired','confirmed'),      -- paiement confirmé tardivement par l'agrégateur (argent déjà débité)
         ('confirmed','refunded')) THEN
      RAISE EXCEPTION 'Transition de commande interdite : % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'confirmed' THEN NEW.confirmed_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_guard BEFORE UPDATE ON vote_orders
  FOR EACH ROW EXECUTE FUNCTION vote_orders_guard_update();
CREATE TRIGGER trg_orders_no_delete BEFORE DELETE ON vote_orders
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Expire les commandes en attente dépassées (à appeler par un job toutes les minutes)
CREATE FUNCTION expire_pending_orders() RETURNS integer LANGUAGE sql AS $$
  WITH x AS (
    UPDATE vote_orders SET status = 'expired'
     WHERE status = 'pending' AND expires_at < now()
    RETURNING 1)
  SELECT count(*)::integer FROM x
$$;

-- Choix du votant enregistrés AVANT paiement ; transformés en votes à la confirmation
CREATE TABLE vote_order_choices (
  order_id      uuid NOT NULL,
  contest_id    uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  quantity      integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, candidate_id),
  FOREIGN KEY (order_id, contest_id)     REFERENCES vote_orders (id, contest_id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id, contest_id) REFERENCES candidates  (id, contest_id)
);

-- VOTES -------------------------------------------------------------------------------------------
CREATE TABLE votes (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id             uuid NOT NULL,
  contest_id           uuid NOT NULL,
  candidate_id         uuid NOT NULL,
  quantity             integer NOT NULL CHECK (quantity > 0),
  is_valid             boolean NOT NULL DEFAULT true,
  invalidated_at       timestamptz,
  invalidated_by       uuid REFERENCES users(id),
  invalidation_reason  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, contest_id)     REFERENCES vote_orders (id, contest_id),
  FOREIGN KEY (candidate_id, contest_id) REFERENCES candidates  (id, contest_id),
  UNIQUE (order_id, candidate_id),
  CONSTRAINT votes_invalidation_traceable CHECK (is_valid OR (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL))
);
CREATE INDEX idx_votes_candidate ON votes (candidate_id) WHERE is_valid;
CREATE INDEX idx_votes_contest_time ON votes (contest_id, created_at);

-- Un vote n'est créé que pour une commande confirmée, un candidat actif, un concours encore ouvert
-- (ou clos depuis moins de `paid_grace_minutes` : paiement confirmé juste après la clôture, REQ-LIFE-003).
CREATE FUNCTION votes_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contests%ROWTYPE; o_status text; grace bigint := COALESCE(setting_int('paid_grace_minutes'), 15);
BEGIN
  SELECT status INTO o_status FROM vote_orders WHERE id = NEW.order_id;
  IF o_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Aucun vote sans commande confirmée (statut : %)', COALESCE(o_status, 'inconnu') USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM candidates WHERE id = NEW.candidate_id AND is_active) THEN
    RAISE EXCEPTION 'Candidat inactif' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM contests WHERE id = NEW.contest_id;
  IF NOT (c.status IN ('active','paused')
          OR (c.status = 'closed' AND now() <= c.closed_at + make_interval(mins => grace::int))) THEN
    RAISE EXCEPTION 'Concours fermé : vote refusé' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_votes_before_insert BEFORE INSERT ON votes
  FOR EACH ROW EXECUTE FUNCTION votes_before_insert();

-- Votes inaltérables : seule l'invalidation (avec motif) est possible, jamais la suppression
CREATE FUNCTION votes_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id <> OLD.order_id OR NEW.contest_id <> OLD.contest_id
     OR NEW.candidate_id <> OLD.candidate_id OR NEW.quantity <> OLD.quantity THEN
    RAISE EXCEPTION 'Un vote n''est pas modifiable ; invalider puis recréer si nécessaire' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_votes_guard BEFORE UPDATE ON votes FOR EACH ROW EXECUTE FUNCTION votes_guard_update();
CREATE TRIGGER trg_votes_no_delete BEFORE DELETE ON votes FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Cohérence en fin de transaction : somme des votes = votes_count de la commande, et nombre de candidats <= max
CREATE FUNCTION check_order_votes_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order_id uuid;
  o vote_orders%ROWTYPE; v_sum bigint; v_cands bigint; v_max smallint;
BEGIN
  IF TG_TABLE_NAME = 'votes' THEN v_order_id := NEW.order_id; ELSE v_order_id := NEW.id; END IF;
  SELECT * INTO o FROM vote_orders WHERE id = v_order_id;
  IF o.status NOT IN ('confirmed','refunded') THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(quantity),0), count(*) INTO v_sum, v_cands FROM votes WHERE order_id = o.id;
  SELECT max_choices_per_vote INTO v_max FROM contests WHERE id = o.contest_id;
  IF v_sum <> o.votes_count THEN
    RAISE EXCEPTION 'Commande % : % votes répartis pour % achetés', o.reference, v_sum, o.votes_count
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_cands > v_max THEN
    RAISE EXCEPTION 'Commande % : % candidats choisis (maximum %)', o.reference, v_cands, v_max
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ctrg_votes_complete AFTER INSERT ON votes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_order_votes_complete();
CREATE CONSTRAINT TRIGGER ctrg_order_confirmed_has_votes AFTER UPDATE OF status ON vote_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'confirmed') EXECUTE FUNCTION check_order_votes_complete();
CREATE CONSTRAINT TRIGGER ctrg_order_inserted_confirmed AFTER INSERT ON vote_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'confirmed') EXECUTE FUNCTION check_order_votes_complete();

-- COMPTEURS (lecture rapide pour les pages de résultats pendant les finales) --------------------------
CREATE TABLE candidate_vote_counts (
  candidate_id  uuid PRIMARY KEY,
  contest_id    uuid NOT NULL REFERENCES contests(id),
  valid_votes   bigint NOT NULL DEFAULT 0,
  paid_votes    bigint NOT NULL DEFAULT 0,
  free_votes    bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (candidate_id, contest_id) REFERENCES candidates (id, contest_id) ON DELETE CASCADE,
  CHECK (valid_votes = paid_votes + free_votes AND valid_votes >= 0)
);
CREATE INDEX idx_counts_contest ON candidate_vote_counts (contest_id, valid_votes DESC);

CREATE FUNCTION apply_vote_delta(p_candidate uuid, p_contest uuid, p_kind text, p_delta bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_paid bigint := CASE WHEN p_kind = 'paid' THEN p_delta ELSE 0 END;
        v_free bigint := CASE WHEN p_kind = 'free' THEN p_delta ELSE 0 END;
BEGIN
  IF p_delta >= 0 THEN
    INSERT INTO candidate_vote_counts (candidate_id, contest_id, valid_votes, paid_votes, free_votes)
    VALUES (p_candidate, p_contest, p_delta, v_paid, v_free)
    ON CONFLICT (candidate_id) DO UPDATE SET
      valid_votes = candidate_vote_counts.valid_votes + p_delta,
      paid_votes  = candidate_vote_counts.paid_votes + v_paid,
      free_votes  = candidate_vote_counts.free_votes + v_free,
      updated_at  = now();
  ELSE
    -- Delta négatif (invalidation) : la ligne existe forcément ; un UPDATE évite le CHECK sur une ligne d'insertion négative
    UPDATE candidate_vote_counts
       SET valid_votes = valid_votes + p_delta, paid_votes = paid_votes + v_paid,
           free_votes = free_votes + v_free, updated_at = now()
     WHERE candidate_id = p_candidate;
  END IF;
END $$;

CREATE FUNCTION votes_maintain_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM vote_orders WHERE id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_valid THEN PERFORM apply_vote_delta(NEW.candidate_id, NEW.contest_id, v_kind, NEW.quantity); END IF;
  ELSIF NEW.is_valid <> OLD.is_valid THEN
    PERFORM apply_vote_delta(NEW.candidate_id, NEW.contest_id, v_kind,
                             CASE WHEN NEW.is_valid THEN NEW.quantity ELSE -NEW.quantity END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_votes_counts AFTER INSERT OR UPDATE OF is_valid ON votes
  FOR EACH ROW EXECUTE FUNCTION votes_maintain_counts();

-- Recalcul complet depuis la table des votes (réconciliation, ou après dérive d'un cache Redis)
CREATE FUNCTION reconcile_vote_counts(p_contest uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM candidate_vote_counts WHERE contest_id = p_contest;
  INSERT INTO candidate_vote_counts (candidate_id, contest_id, valid_votes, paid_votes, free_votes)
  SELECT v.candidate_id, v.contest_id,
         sum(v.quantity),
         COALESCE(sum(v.quantity) FILTER (WHERE o.kind = 'paid'), 0),
         COALESCE(sum(v.quantity) FILTER (WHERE o.kind = 'free'), 0)
    FROM votes v JOIN vote_orders o ON o.id = v.order_id
   WHERE v.contest_id = p_contest AND v.is_valid
   GROUP BY v.candidate_id, v.contest_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Classement public d'un concours (candidats sans vote inclus)
CREATE VIEW contest_results AS
SELECT c.contest_id, c.id AS candidate_id, c.number, c.name, c.image_key, c.is_active,
       COALESCE(k.valid_votes, 0) AS valid_votes,
       COALESCE(k.paid_votes, 0)  AS paid_votes,
       COALESCE(k.free_votes, 0)  AS free_votes,
       rank() OVER (PARTITION BY c.contest_id ORDER BY COALESCE(k.valid_votes, 0) DESC) AS rank
  FROM candidates c
  LEFT JOIN candidate_vote_counts k ON k.candidate_id = c.id;


-- CONFIRMATION -----------------------------------------------------------------------------------------
-- Transforme les choix d'une commande en votes (idempotent grâce à UNIQUE (order_id, candidate_id))
CREATE FUNCTION materialize_votes(p_order uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO votes (order_id, contest_id, candidate_id, quantity)
  SELECT order_id, contest_id, candidate_id, quantity FROM vote_order_choices WHERE order_id = p_order
  ON CONFLICT (order_id, candidate_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Vote gratuit : à appeler une fois le code SMS vérifié. Rejouable sans effet de bord.
CREATE FUNCTION confirm_free_order(p_order uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o vote_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM vote_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF o.kind <> 'free' THEN RAISE EXCEPTION 'confirm_free_order réservé aux votes gratuits'; END IF;
  IF o.status = 'confirmed' THEN
    RETURN jsonb_build_object('status', 'already_confirmed', 'reference', o.reference);
  END IF;
  UPDATE vote_orders SET status = 'confirmed' WHERE id = o.id;
  PERFORM materialize_votes(o.id);
  RETURN jsonb_build_object('status', 'confirmed', 'reference', o.reference);
END $$;
