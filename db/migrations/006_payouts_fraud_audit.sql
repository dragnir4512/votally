-- 006 — Retraits créateurs, fraude, audit, notifications (REQ-PAYOUT, REQ-FRAUD, REQ-ADMIN)

-- AUDIT (immuable) --------------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid,
  actor_type     text NOT NULL CHECK (actor_type IN ('user','admin','system','webhook')),
  action         text NOT NULL,
  object_type    text NOT NULL,
  object_id      text,
  before_data    jsonb,
  after_data     jsonb,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_object ON audit_logs (object_type, object_id, created_at);
CREATE INDEX idx_audit_actor  ON audit_logs (actor_user_id, created_at);
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE FUNCTION audit(p_actor uuid, p_actor_type text, p_action text, p_object_type text, p_object_id text,
                      p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL, p_ip inet DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_logs (actor_user_id, actor_type, action, object_type, object_id, before_data, after_data, ip)
  VALUES (p_actor, p_actor_type, p_action, p_object_type, p_object_id, p_before, p_after, p_ip)
$$;

-- Journalisation automatique des changements sensibles (acteur lu dans votally.actor_id si l'API le renseigne)
CREATE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid := NULLIF(current_setting('votally.actor_id', true), '')::uuid;
BEGIN
  INSERT INTO audit_logs (actor_user_id, actor_type, action, object_type, object_id, before_data, after_data)
  VALUES (v_actor, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
          lower(TG_OP) || '.' || TG_TABLE_NAME, TG_TABLE_NAME,
          COALESCE((to_jsonb(NEW) ->> 'id'), (to_jsonb(NEW) ->> 'key')),
          to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_kyc BEFORE UPDATE ON creator_kyc FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER trg_audit_settings BEFORE UPDATE ON platform_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER trg_audit_contest_freeze AFTER UPDATE OF payout_frozen_at ON contests
  FOR EACH ROW WHEN (NEW.payout_frozen_at IS DISTINCT FROM OLD.payout_frozen_at) EXECUTE FUNCTION audit_row_change();

-- RETRAITS ----------------------------------------------------------------------------------------
CREATE TABLE payouts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id),
  kyc_id                   uuid NOT NULL REFERENCES creator_kyc(id),
  amount_xaf               integer NOT NULL CHECK (amount_xaf > 0),      -- débité du solde du créateur
  fee_xaf                  integer NOT NULL DEFAULT 0 CHECK (fee_xaf >= 0),
  net_xaf                  integer NOT NULL CHECK (net_xaf > 0),         -- reçu par le créateur
  method                   text NOT NULL CHECK (method IN ('mtn_momo','orange_money')),
  destination_phone_masked text NOT NULL,
  provider                 text,
  provider_reference       text,
  status                   text NOT NULL DEFAULT 'requested'
                             CHECK (status IN ('requested','processing','succeeded','failed','cancelled')),
  twofa_verified_at        timestamptz NOT NULL,                         -- REQ-AUTH-009 : double authentification obligatoire
  failure_reason           text,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_amounts CHECK (amount_xaf = fee_xaf + net_xaf),
  UNIQUE (provider, provider_reference)
);
CREATE INDEX idx_payouts_user ON payouts (user_id, status);
CREATE TRIGGER trg_payouts_updated BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payouts_no_delete BEFORE DELETE ON payouts FOR EACH ROW EXECUTE FUNCTION block_mutation();
CREATE TRIGGER trg_audit_payouts AFTER UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Solde retirable = solde créateur global
--                 - soldes des concours non éligibles (non clos, délai de sécurité non écoulé, fonds gelés)
--                 - retraits en cours (demandés / en traitement, pas encore comptabilisés)
CREATE FUNCTION creator_withdrawable_xaf(p_user uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT sum(CASE e.direction WHEN 'credit' THEN e.amount_xaf ELSE -e.amount_xaf END)
                FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
               WHERE a.owner_user_id = p_user AND a.kind = 'liability'), 0)
    - COALESCE((SELECT sum(b.balance_xaf)
                  FROM creator_contest_balances b JOIN contests c ON c.id = b.contest_id
                 WHERE b.user_id = p_user
                   AND NOT (c.status IN ('closed','archived')
                            AND c.closed_at + make_interval(hours => COALESCE(setting_int('payout_delay_hours'), 72)::int) <= now()
                            AND c.payout_frozen_at IS NULL)), 0)
    - COALESCE((SELECT sum(amount_xaf) FROM payouts WHERE user_id = p_user AND status IN ('requested','processing')), 0)
  )
$$;

CREATE FUNCTION payouts_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k creator_kyc%ROWTYPE; v_min bigint := COALESCE(setting_int('min_payout_xaf'), 5000);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payout:' || NEW.user_id::text, 0));   -- évite les retraits simultanés
  SELECT * INTO k FROM creator_kyc WHERE id = NEW.kyc_id;
  IF NOT FOUND OR k.user_id <> NEW.user_id OR k.status <> 'approved' THEN
    RAISE EXCEPTION 'Retrait impossible : KYC non validé' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.method <> k.payout_method THEN
    RAISE EXCEPTION 'Le moyen de retrait doit correspondre au compte vérifié par le KYC' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_xaf < v_min THEN
    RAISE EXCEPTION 'Montant inférieur au seuil minimum de retrait (% FCFA)', v_min USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_xaf > creator_withdrawable_xaf(NEW.user_id) THEN
    RAISE EXCEPTION 'Montant supérieur au solde retirable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payouts_before_insert BEFORE INSERT ON payouts
  FOR EACH ROW EXECUTE FUNCTION payouts_before_insert();

CREATE FUNCTION payouts_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.amount_xaf <> OLD.amount_xaf OR NEW.fee_xaf <> OLD.fee_xaf
     OR NEW.net_xaf <> OLD.net_xaf OR NEW.kyc_id <> OLD.kyc_id THEN
    RAISE EXCEPTION 'Montants et bénéficiaire d''un retrait non modifiables' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
       ('requested','processing'), ('requested','cancelled'), ('requested','failed'),
       ('processing','succeeded'), ('processing','failed')) THEN
    RAISE EXCEPTION 'Transition de retrait interdite : % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payouts_guard BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION payouts_guard_update();

-- Retrait exécuté : débit du solde créateur, sortie du compte de transit. Idempotent.
CREATE FUNCTION complete_payout(p_payout uuid, p_provider text, p_provider_reference text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE po payouts%ROWTYPE; v_tx uuid;
BEGIN
  SELECT * INTO po FROM payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retrait introuvable'; END IF;
  IF po.status = 'succeeded' THEN RETURN jsonb_build_object('status', 'already_completed'); END IF;
  IF po.status = 'requested' THEN UPDATE payouts SET status = 'processing' WHERE id = po.id; END IF;

  UPDATE payouts SET status = 'succeeded', provider = p_provider, provider_reference = p_provider_reference,
                     completed_at = now() WHERE id = po.id;

  INSERT INTO ledger_transactions (kind, payout_id, description, idempotency_key)
  VALUES ('payout', po.id, 'Retrait ' || po.id, 'payout:' || po.id)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_tx;
  IF v_tx IS NOT NULL THEN
    PERFORM ledger_add(v_tx, ledger_account('LIABILITY:CREATOR:' || po.user_id, 'liability', po.user_id), NULL, 'debit',  po.amount_xaf);
    PERFORM ledger_add(v_tx, ledger_account('CLEARING:' || p_provider, 'asset', NULL, p_provider),        NULL, 'credit', po.amount_xaf);
  END IF;
  RETURN jsonb_build_object('status', 'completed', 'net_xaf', po.net_xaf);
END $$;

-- FRAUDE ------------------------------------------------------------------------------------------
CREATE TABLE fraud_flags (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contest_id   uuid NOT NULL REFERENCES contests(id),
  order_id     uuid REFERENCES vote_orders(id),
  vote_id      bigint REFERENCES votes(id),
  rule         text NOT NULL,                   -- ex. 'burst_same_candidate', 'many_orders_one_device', 'phone_velocity'
  score        smallint NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','dismissed')),
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fraud_has_target CHECK (order_id IS NOT NULL OR vote_id IS NOT NULL OR rule LIKE 'contest\_%')
);
CREATE INDEX idx_fraud_open ON fraud_flags (contest_id, created_at) WHERE status = 'open';

-- Invalidation manuelle d'un vote (toujours journalisée). Pour un vote payant, le remboursement
-- reste une décision distincte : appeler refund_payment() si l'administrateur le décide.
CREATE FUNCTION invalidate_vote(p_vote bigint, p_actor uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Motif d''invalidation obligatoire'; END IF;
  UPDATE votes SET is_valid = false, invalidated_at = now(), invalidated_by = p_actor, invalidation_reason = p_reason
   WHERE id = p_vote AND is_valid;
  IF FOUND THEN
    PERFORM audit(p_actor, 'admin', 'vote.invalidate', 'vote', p_vote::text, NULL, jsonb_build_object('reason', p_reason));
  END IF;
END $$;

-- NOTIFICATIONS -----------------------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  channel     text NOT NULL CHECK (channel IN ('email','sms','whatsapp','push')),
  template    text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts    smallint NOT NULL DEFAULT 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_queue ON notifications (created_at) WHERE status = 'queued';
