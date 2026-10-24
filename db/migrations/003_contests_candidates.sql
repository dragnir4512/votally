-- 003 — Concours, cycle de vie, co-gestion, candidats, packs de votes
-- (REQ-CONTEST, REQ-LIFE, REQ-TEAM, REQ-CAND)

CREATE TABLE contests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                uuid NOT NULL REFERENCES users(id),
  name                    text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  slug                    citext NOT NULL UNIQUE,
  description             text,
  rules                   text,                                   -- règlement : obligatoire à l'activation
  organizer_name          text,
  category                text,
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','active','paused','closed','archived')),
  vote_type               text NOT NULL DEFAULT 'free' CHECK (vote_type IN ('free','paid','mixed')),
  vote_price_xaf          integer NOT NULL DEFAULT 0 CHECK (vote_price_xaf >= 0),   -- FCFA entiers
  currency                char(3) NOT NULL DEFAULT 'XAF' CHECK (currency = 'XAF'),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  visibility              text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  access_password_hash    text,
  results_display         text NOT NULL DEFAULT 'realtime' CHECK (results_display IN ('realtime','on_close','hidden')),
  max_choices_per_vote    smallint NOT NULL DEFAULT 1 CHECK (max_choices_per_vote >= 1),   -- mode multiple
  free_votes_per_period   smallint NOT NULL DEFAULT 1 CHECK (free_votes_per_period >= 0),  -- par numéro de téléphone
  free_vote_period_hours  integer NOT NULL DEFAULT 24 CHECK (free_vote_period_hours > 0),
  default_locale          text NOT NULL DEFAULT 'fr' CHECK (default_locale IN ('fr','en')),
  theme                   jsonb NOT NULL DEFAULT '{}'::jsonb,     -- couleurs, logo, favicon, polices
  banner_key              text,
  payout_frozen_at        timestamptz,                            -- gel des fonds en cas de litige / fraude
  payout_frozen_reason    text,
  activated_at            timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contests_slug_format CHECK (slug::text = lower(slug::text) AND slug::text ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  CONSTRAINT contests_dates_order CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT contests_price_matches_type CHECK (
    (vote_type = 'free' AND vote_price_xaf = 0) OR (vote_type IN ('paid','mixed') AND vote_price_xaf > 0)
  )
);
CREATE INDEX idx_contests_owner  ON contests (owner_id, status);
CREATE INDEX idx_contests_status ON contests (status, starts_at, ends_at);
CREATE TRIGGER trg_contests_updated BEFORE UPDATE ON contests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historique des changements d'état (REQ-LIFE-005). Sans FK : l'audit survit à la suppression d'un brouillon.
CREATE TABLE contest_status_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contest_id   uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  changed_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_contest ON contest_status_history (contest_id, created_at);
CREATE TRIGGER trg_status_history_immutable BEFORE UPDATE OR DELETE ON contest_status_history
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Slug réservé, prix minimum, propriétaire vérifié
CREATE FUNCTION contests_check_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_min bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'Slug réservé : %', NEW.slug USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.vote_type IN ('paid','mixed') THEN
    v_min := setting_int('min_vote_price_xaf');
    IF v_min IS NOT NULL AND NEW.vote_price_xaf < v_min THEN
      RAISE EXCEPTION 'Prix du vote (% FCFA) inférieur au minimum plateforme (% FCFA)', NEW.vote_price_xaf, v_min
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- REQ-AUTH-003 : email ou téléphone vérifié avant de créer un concours
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id
                   AND (email_verified_at IS NOT NULL OR phone_verified_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Le propriétaire doit avoir vérifié son email ou son téléphone' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_contests_rules_ins BEFORE INSERT ON contests
  FOR EACH ROW EXECUTE FUNCTION contests_check_rules();
CREATE TRIGGER trg_contests_rules_upd BEFORE UPDATE OF slug, vote_type, vote_price_xaf ON contests
  FOR EACH ROW EXECUTE FUNCTION contests_check_rules();

-- Transitions autorisées, verrouillage des champs sensibles, conditions d'activation
CREATE FUNCTION contests_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR NEW.owner_id       IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'Prix, type de vote, slug et propriétaire sont verrouillés après le lancement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_contests_guard BEFORE UPDATE ON contests
  FOR EACH ROW EXECUTE FUNCTION contests_guard_update();

-- Suppression : brouillons uniquement (sinon on archive)
CREATE FUNCTION contests_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Seuls les brouillons peuvent être supprimés ; archiver le concours à la place'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_contests_guard_del BEFORE DELETE ON contests
  FOR EACH ROW EXECUTE FUNCTION contests_guard_delete();

-- Historique + membre propriétaire automatique.
-- L'application peut renseigner l'acteur par : SELECT set_config('votally.actor_id', '<uuid>', true);
CREATE FUNCTION contests_after_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid := NULLIF(current_setting('votally.actor_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contest_status_history (contest_id, from_status, to_status, changed_by)
      VALUES (NEW.id, NULL, NEW.status, COALESCE(v_actor, NEW.owner_id));
    INSERT INTO contest_members (contest_id, user_id, role, status, accepted_at)
      VALUES (NEW.id, NEW.owner_id, 'owner', 'active', now());
  ELSIF NEW.status <> OLD.status THEN
    INSERT INTO contest_status_history (contest_id, from_status, to_status, changed_by)
      VALUES (NEW.id, OLD.status, NEW.status, v_actor);
  END IF;
  RETURN NEW;
END $$;

-- Co-gestion par invitation (REQ-TEAM) : rôles owner / manager / viewer
CREATE TABLE contest_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id         uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES users(id),
  role               text NOT NULL CHECK (role IN ('owner','manager','viewer')),
  status             text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked')),
  invite_token_hash  bytea UNIQUE,                      -- lien d'invitation (WhatsApp/email), haché
  invited_by         uuid REFERENCES users(id),
  invite_expires_at  timestamptz,
  accepted_at        timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_user_when_accepted CHECK (status = 'invited' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_member_user ON contest_members (contest_id, user_id) WHERE user_id IS NOT NULL AND status <> 'revoked';
CREATE UNIQUE INDEX uq_member_one_owner ON contest_members (contest_id) WHERE role = 'owner' AND status = 'active';

CREATE TRIGGER trg_contests_after AFTER INSERT OR UPDATE OF status ON contests
  FOR EACH ROW EXECUTE FUNCTION contests_after_write();

-- Candidats
CREATE TABLE candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  number       integer,                                  -- numérotation automatique si NULL
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description  text,
  image_key    text,                                     -- clé de stockage (versions mobiles générées côté application)
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, number),
  UNIQUE (id, contest_id)                                -- cible des clés étrangères composites (votes)
);
CREATE INDEX idx_candidates_contest ON candidates (contest_id, sort_order);
CREATE TRIGGER trg_candidates_updated BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION candidates_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN
    PERFORM 1 FROM contests WHERE id = NEW.contest_id FOR UPDATE;   -- sérialise la numérotation
    SELECT COALESCE(max(number), 0) + 1 INTO NEW.number FROM candidates WHERE contest_id = NEW.contest_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_candidates_number BEFORE INSERT ON candidates
  FOR EACH ROW EXECUTE FUNCTION candidates_before_insert();

-- REQ-CAND-006 : suppression avant lancement uniquement ; ensuite désactivation (is_active = false)
CREATE FUNCTION candidates_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM contests WHERE id = OLD.contest_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'Candidat non supprimable après lancement : le désactiver à la place'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_candidates_guard_del BEFORE DELETE ON candidates
  FOR EACH ROW EXECUTE FUNCTION candidates_guard_delete();

-- Packs de votes (ex. 10 votes pour 900 FCFA)
CREATE TABLE vote_packs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id   uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  label        text,
  votes_count  integer NOT NULL CHECK (votes_count > 0),
  price_xaf    integer NOT NULL CHECK (price_xaf > 0),   -- prix total du pack
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, votes_count),
  UNIQUE (id, contest_id)
);
