-- 005 — Paiements, webhooks, ledger comptable à double entrée (REQ-PAY)
--
-- Principes :
--  * un paiement réussi par commande, au plus (index unique partiel) -> aucun double comptage ;
--  * un vote payant n'existe qu'après un paiement réussi dont le montant égale le total de la commande ;
--  * le ledger est immuable : on corrige par écriture inverse, jamais par modification ;
--  * chaque transaction comptable est équilibrée (débits = crédits), vérifié en fin de transaction SQL.

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES vote_orders(id),
  provider            text NOT NULL,                       -- 'cinetpay', 'notchpay', 'monetbil', 'campay', 'flutterwave'...
  method              text NOT NULL CHECK (method IN ('mtn_momo','orange_money','card')),
  provider_reference  text,                                -- identifiant côté agrégateur
  status              text NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated','pending','succeeded','failed','expired','refunded')),
  amount_xaf          integer NOT NULL CHECK (amount_xaf > 0),   -- total payé par le votant (prix + frais)
  fee_xaf             integer NOT NULL DEFAULT 0 CHECK (fee_xaf >= 0),
  currency            char(3) NOT NULL DEFAULT 'XAF' CHECK (currency = 'XAF'),
  payer_phone_masked  text,
  needs_refund        boolean NOT NULL DEFAULT false,      -- argent encaissé mais votes non comptables (concours clos hors délai)
  failure_reason      text,
  raw_response        jsonb,
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference)
);
CREATE UNIQUE INDEX uq_payment_one_success_per_order ON payments (order_id) WHERE status = 'succeeded';
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_open ON payments (status, initiated_at) WHERE status IN ('initiated','pending');
CREATE INDEX idx_payments_needs_refund ON payments (initiated_at) WHERE needs_refund;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION payments_check_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o vote_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM vote_orders WHERE id = NEW.order_id;
  IF o.kind <> 'paid' THEN
    RAISE EXCEPTION 'Un paiement ne peut concerner qu''une commande payante' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_xaf <> o.total_xaf OR NEW.fee_xaf <> o.fee_xaf THEN
    RAISE EXCEPTION 'Montant du paiement (%) différent du total de la commande (%)', NEW.amount_xaf, o.total_xaf
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_check_ins BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_check_insert();

CREATE FUNCTION payments_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id <> OLD.order_id OR NEW.amount_xaf <> OLD.amount_xaf OR NEW.fee_xaf <> OLD.fee_xaf
     OR NEW.provider <> OLD.provider THEN
    RAISE EXCEPTION 'Montant, commande et agrégateur d''un paiement ne sont pas modifiables' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
       ('initiated','pending'), ('initiated','succeeded'), ('initiated','failed'), ('initiated','expired'),
       ('pending','succeeded'), ('pending','failed'), ('pending','expired'),
       ('expired','succeeded'),                -- webhook tardif
       ('succeeded','refunded')) THEN
    RAISE EXCEPTION 'Transition de paiement interdite : % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_guard BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard_update();
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Une commande payante ne passe en "confirmed" que si un paiement réussi du bon montant existe
CREATE FUNCTION vote_orders_require_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'paid' AND NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN
    IF NOT EXISTS (SELECT 1 FROM payments WHERE order_id = NEW.id AND status = 'succeeded' AND amount_xaf = NEW.total_xaf) THEN
      RAISE EXCEPTION 'Commande % : aucun paiement réussi correspondant', NEW.reference USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_require_payment BEFORE UPDATE OF status ON vote_orders
  FOR EACH ROW EXECUTE FUNCTION vote_orders_require_payment();

-- Webhooks entrants : stockés bruts, dédoublonnés (protection contre le rejeu)
CREATE TABLE webhook_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider         text NOT NULL,
  event_id         text NOT NULL,                         -- identifiant d'événement ou, à défaut, référence + statut
  signature_valid  boolean NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  processing_error text,
  UNIQUE (provider, event_id)
);
CREATE INDEX idx_webhooks_unprocessed ON webhook_events (received_at) WHERE processed_at IS NULL;

-- LEDGER ------------------------------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  kind           text NOT NULL CHECK (kind IN ('asset','liability','revenue','expense')),
  owner_user_id  uuid REFERENCES users(id),               -- compte créateur
  provider       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('payment','unallocated','refund','payout','adjustment')),
  order_id         uuid REFERENCES vote_orders(id),
  payment_id       uuid REFERENCES payments(id),
  payout_id        uuid,
  contest_id       uuid REFERENCES contests(id),
  description      text,
  idempotency_key  text NOT NULL UNIQUE,                  -- 'payment:<id>', 'refund:<id>', 'payout:<id>'
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts(id),
  contest_id      uuid REFERENCES contests(id),
  direction       text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_xaf      bigint NOT NULL CHECK (amount_xaf > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_entries_tx ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id, contest_id);

CREATE TRIGGER trg_ledger_tx_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION block_mutation();
CREATE TRIGGER trg_ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Équilibre débits = crédits vérifié au COMMIT de chaque transaction SQL
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n integer;
BEGIN
  SELECT COALESCE(sum(amount_xaf) FILTER (WHERE direction = 'debit'), 0),
         COALESCE(sum(amount_xaf) FILTER (WHERE direction = 'credit'), 0), count(*)
    INTO d, c, n FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c OR n < 2 THEN
    RAISE EXCEPTION 'Transaction comptable % déséquilibrée : débits % / crédits % (% écritures)',
      NEW.transaction_id, d, c, n USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ctrg_ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Récupère ou crée un compte (idempotent)
CREATE FUNCTION ledger_account(p_code text, p_kind text, p_owner uuid DEFAULT NULL, p_provider text DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ledger_accounts (code, kind, owner_user_id, provider) VALUES (p_code, p_kind, p_owner, p_provider)
  ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
  RETURNING id
$$;

CREATE FUNCTION ledger_add(p_tx uuid, p_account uuid, p_contest uuid, p_dir text, p_amount bigint) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO ledger_entries (transaction_id, account_id, contest_id, direction, amount_xaf)
  SELECT p_tx, p_account, p_contest, p_dir, p_amount WHERE p_amount > 0
$$;

-- Paiement confirmé : l'argent entre en compte de transit, puis se répartit.
--   Débit  CLEARING:<agrégateur>        total payé (prix + frais)
--   Crédit LIABILITY:CREATOR:<user>     part nette du créateur (prix - commission)
--   Crédit REVENUE:COMMISSION           commission VOTALLY (8 %)
--   Crédit LIABILITY:PROVIDER_FEES      frais de transaction dus à l'agrégateur
-- Exemple : 1 000 FCFA de votes + 25 FCFA de frais -> 1 025 = 920 + 80 + 25
CREATE FUNCTION ledger_post_payment(p_payment uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  pay payments%ROWTYPE; o vote_orders%ROWTYPE; v_owner uuid; v_tx uuid;
  v_clearing uuid; v_creator uuid; v_comm uuid; v_fees uuid;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment;
  IF NOT FOUND OR pay.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Paiement % introuvable ou non réussi', p_payment;
  END IF;
  SELECT * INTO o FROM vote_orders WHERE id = pay.order_id;
  SELECT owner_id INTO v_owner FROM contests WHERE id = o.contest_id;

  INSERT INTO ledger_transactions (kind, order_id, payment_id, contest_id, description, idempotency_key)
  VALUES ('payment', o.id, pay.id, o.contest_id, 'Paiement ' || o.reference, 'payment:' || pay.id)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx;
  IF v_tx IS NULL THEN                       -- déjà comptabilisé : rien à refaire
    SELECT id INTO v_tx FROM ledger_transactions WHERE idempotency_key = 'payment:' || pay.id;
    RETURN v_tx;
  END IF;

  v_clearing := ledger_account('CLEARING:' || pay.provider, 'asset', NULL, pay.provider);
  v_creator  := ledger_account('LIABILITY:CREATOR:' || v_owner, 'liability', v_owner);
  v_comm     := ledger_account('REVENUE:COMMISSION', 'revenue');
  v_fees     := ledger_account('LIABILITY:PROVIDER_FEES', 'liability');

  PERFORM ledger_add(v_tx, v_clearing, o.contest_id, 'debit',  pay.amount_xaf);
  PERFORM ledger_add(v_tx, v_creator,  o.contest_id, 'credit', o.creator_net_xaf);
  PERFORM ledger_add(v_tx, v_comm,     o.contest_id, 'credit', o.commission_xaf);
  PERFORM ledger_add(v_tx, v_fees,     o.contest_id, 'credit', o.fee_xaf);
  RETURN v_tx;
END $$;

-- Argent encaissé mais votes non comptables : le total est mis en attente de remboursement
CREATE FUNCTION ledger_post_unallocated(p_payment uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE; o vote_orders%ROWTYPE; v_tx uuid;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment;
  SELECT * INTO o FROM vote_orders WHERE id = pay.order_id;
  INSERT INTO ledger_transactions (kind, order_id, payment_id, contest_id, description, idempotency_key)
  VALUES ('unallocated', o.id, pay.id, o.contest_id, 'À rembourser ' || o.reference, 'unallocated:' || pay.id)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_tx;
  IF v_tx IS NULL THEN RETURN NULL; END IF;
  PERFORM ledger_add(v_tx, ledger_account('CLEARING:' || pay.provider, 'asset', NULL, pay.provider), o.contest_id, 'debit',  pay.amount_xaf);
  PERFORM ledger_add(v_tx, ledger_account('LIABILITY:REFUNDS_DUE', 'liability'),                       o.contest_id, 'credit', pay.amount_xaf);
  RETURN v_tx;
END $$;

-- Remboursement : écriture inverse de la comptabilisation d'origine
CREATE FUNCTION ledger_post_refund(p_payment uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE; o vote_orders%ROWTYPE; v_owner uuid; v_tx uuid; v_unalloc boolean;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment;
  IF NOT FOUND OR pay.status <> 'refunded' THEN
    RAISE EXCEPTION 'Paiement % non remboursé', p_payment;
  END IF;
  SELECT * INTO o FROM vote_orders WHERE id = pay.order_id;
  SELECT owner_id INTO v_owner FROM contests WHERE id = o.contest_id;
  v_unalloc := EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'unallocated:' || pay.id);

  INSERT INTO ledger_transactions (kind, order_id, payment_id, contest_id, description, idempotency_key)
  VALUES ('refund', o.id, pay.id, o.contest_id, 'Remboursement ' || o.reference, 'refund:' || pay.id)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_tx;
  IF v_tx IS NULL THEN
    SELECT id INTO v_tx FROM ledger_transactions WHERE idempotency_key = 'refund:' || pay.id;
    RETURN v_tx;
  END IF;

  IF v_unalloc THEN
    PERFORM ledger_add(v_tx, ledger_account('LIABILITY:REFUNDS_DUE', 'liability'), o.contest_id, 'debit', pay.amount_xaf);
  ELSE
    PERFORM ledger_add(v_tx, ledger_account('LIABILITY:CREATOR:' || v_owner, 'liability', v_owner), o.contest_id, 'debit', o.creator_net_xaf);
    PERFORM ledger_add(v_tx, ledger_account('REVENUE:COMMISSION', 'revenue'),                         o.contest_id, 'debit', o.commission_xaf);
    PERFORM ledger_add(v_tx, ledger_account('LIABILITY:PROVIDER_FEES', 'liability'),                  o.contest_id, 'debit', o.fee_xaf);
  END IF;
  PERFORM ledger_add(v_tx, ledger_account('CLEARING:' || pay.provider, 'asset', NULL, pay.provider), o.contest_id, 'credit', pay.amount_xaf);
  RETURN v_tx;
END $$;

-- POINT D'ENTRÉE UNIQUE pour un paiement réussi (webhook ou vérification serveur à serveur).
-- Atomique et rejouable : appeler deux fois ne compte jamais deux fois.
CREATE FUNCTION confirm_payment_and_votes(p_payment uuid, p_provider_reference text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE; o vote_orders%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable'; END IF;
  SELECT * INTO o FROM vote_orders WHERE id = pay.order_id FOR UPDATE;

  IF pay.status = 'succeeded' AND o.status = 'confirmed' THEN
    RETURN jsonb_build_object('status', 'already_confirmed', 'reference', o.reference);
  END IF;
  IF pay.status = 'succeeded' AND pay.needs_refund THEN
    RETURN jsonb_build_object('status', 'needs_refund', 'reference', o.reference);
  END IF;
  IF pay.status NOT IN ('initiated','pending','expired','succeeded') THEN
    RAISE EXCEPTION 'Paiement en statut % : confirmation impossible', pay.status;
  END IF;

  UPDATE payments
     SET status = 'succeeded', completed_at = now(),
         provider_reference = COALESCE(p_provider_reference, provider_reference)
   WHERE id = pay.id;

  BEGIN
    UPDATE vote_orders SET status = 'confirmed' WHERE id = o.id AND status IN ('pending','expired');
    PERFORM materialize_votes(o.id);
    PERFORM ledger_post_payment(pay.id);
    RETURN jsonb_build_object('status', 'confirmed', 'reference', o.reference);
  EXCEPTION WHEN check_violation THEN
    -- Concours clos hors délai de grâce, candidat désactivé... : l'argent est conservé, un remboursement est signalé.
    UPDATE payments SET needs_refund = true WHERE id = pay.id;
    PERFORM ledger_post_unallocated(pay.id);
    RETURN jsonb_build_object('status', 'needs_refund', 'reference', o.reference);
  END;
END $$;

-- Échec / expiration d'un paiement : aucune écriture comptable, la commande suit
CREATE FUNCTION fail_payment(p_payment uuid, p_reason text, p_expired boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF pay.status IN ('succeeded','refunded','failed') THEN RETURN; END IF;
  UPDATE payments SET status = CASE WHEN p_expired THEN 'expired' ELSE 'failed' END,
                      failure_reason = p_reason, completed_at = now() WHERE id = pay.id;
  -- La commande reste en attente tant qu'un autre paiement peut aboutir (relance) ; sinon elle expire seule
END $$;

-- Marque un paiement comme remboursé et passe l'écriture inverse ; invalide les votes associés
CREATE FUNCTION refund_payment(p_payment uuid, p_actor uuid, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE; o vote_orders%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF pay.status = 'refunded' THEN RETURN ledger_post_refund(pay.id); END IF;
  UPDATE payments SET status = 'refunded', needs_refund = false WHERE id = pay.id;
  SELECT * INTO o FROM vote_orders WHERE id = pay.order_id FOR UPDATE;
  IF o.status = 'confirmed' THEN
    UPDATE votes SET is_valid = false, invalidated_at = now(), invalidated_by = p_actor,
                     invalidation_reason = 'Remboursement : ' || COALESCE(p_reason, '')
     WHERE order_id = o.id AND is_valid;
    UPDATE vote_orders SET status = 'refunded' WHERE id = o.id;
  END IF;
  RETURN ledger_post_refund(pay.id);
END $$;

-- VUES COMPTABLES ---------------------------------------------------------------------------------
CREATE VIEW ledger_balances AS
SELECT a.id AS account_id, a.code, a.kind, a.owner_user_id,
       COALESCE(sum(CASE WHEN e.direction = 'debit'  THEN e.amount_xaf END), 0) AS total_debit_xaf,
       COALESCE(sum(CASE WHEN e.direction = 'credit' THEN e.amount_xaf END), 0) AS total_credit_xaf,
       COALESCE(sum(CASE WHEN (a.kind IN ('asset','expense')) = (e.direction = 'debit')
                         THEN e.amount_xaf ELSE -e.amount_xaf END), 0) AS balance_xaf   -- solde dans le sens normal du compte
  FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
 GROUP BY a.id;

-- Solde par créateur et par concours (crédits - débits des comptes passif créateur)
CREATE VIEW creator_contest_balances AS
SELECT a.owner_user_id AS user_id, e.contest_id,
       sum(CASE e.direction WHEN 'credit' THEN e.amount_xaf ELSE -e.amount_xaf END) AS balance_xaf
  FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
 WHERE a.kind = 'liability' AND a.owner_user_id IS NOT NULL AND e.contest_id IS NOT NULL
 GROUP BY a.owner_user_id, e.contest_id;

-- Contrôle global : doit toujours renvoyer 0 (sinon alerte)
CREATE VIEW ledger_integrity AS
SELECT COALESCE(sum(CASE WHEN direction = 'debit' THEN amount_xaf ELSE -amount_xaf END), 0) AS imbalance_xaf
  FROM ledger_entries;
