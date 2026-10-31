-- Tests d'intégrité VOTALLY — à lancer sur une base migrée. Tout est annulé à la fin (ROLLBACK).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
BEGIN;

CREATE FUNCTION pg_temp.expect_fail(p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || p_like || '%' THEN RETURN; END IF;
    RAISE EXCEPTION 'Erreur inattendue (attendu "%") : %', p_like, SQLERRM;
  END;
  RAISE EXCEPTION 'Aurait dû échouer ("%") : %', p_like, p_sql;
END $$;

CREATE FUNCTION pg_temp.eq(p_label text, p_actual numeric, p_expected numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC % : obtenu %, attendu %', p_label, p_actual, p_expected;
  END IF;
  RAISE NOTICE 'OK   %', p_label;
END $$;

CREATE FUNCTION pg_temp.bal(p_code text) RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE((SELECT balance_xaf FROM ledger_balances WHERE code = p_code), 0)
$$;

DO $$
DECLARE
  -- Soldes de départ des comptes globaux : le test fonctionne aussi sur une base déjà utilisée
  b_clear bigint := pg_temp.bal('CLEARING:cinetpay'); b_comm bigint := pg_temp.bal('REVENUE:COMMISSION');
  b_fees bigint := pg_temp.bal('LIABILITY:PROVIDER_FEES'); b_refund bigint := pg_temp.bal('LIABILITY:REFUNDS_DUE');
  u_owner uuid; u_unverified uuid;
  c_free uuid; c_paid uuid; c_late uuid;
  ca uuid; cb uuid; pa uuid; pb uuid; la uuid; lb uuid;
  o uuid; o2 uuid; pay uuid; pay2 uuid; res jsonb; kyc uuid; po uuid; v_vote bigint;
BEGIN
  INSERT INTO users (email, email_verified_at, full_name) VALUES ('owner@test.cm', now(), 'Créateur Test') RETURNING id INTO u_owner;
  INSERT INTO users (email) VALUES ('nonverifie@test.cm') RETURNING id INTO u_unverified;

  -- ============ CONCOURS ============
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug) VALUES (%L,'Concours X','admin')$f$, u_owner), 'Slug réservé');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug) VALUES (%L,'Concours X','Mauvais Slug')$f$, u_owner), 'contests_slug_format');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug) VALUES (%L,'Espace','espace')$f$, u_owner), 'Slug réservé');   -- migration 009
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug) VALUES (%L,'Concours X','concours-x')$f$, u_unverified), 'vérifié');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug,vote_type,vote_price_xaf) VALUES (%L,'Payant','payant-trop-bas','paid',50)$f$, u_owner), 'minimum plateforme');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO contests (owner_id,name,slug,vote_type,vote_price_xaf) VALUES (%L,'Incohérent','incoherent','free',100)$f$, u_owner), 'contests_price_matches_type');

  INSERT INTO contests (owner_id, name, slug, rules, vote_type) VALUES (u_owner, 'Miss Test Gratuit', 'miss-test', 'Règlement', 'free') RETURNING id INTO c_free;
  PERFORM pg_temp.eq('propriétaire ajouté automatiquement', (SELECT count(*) FROM contest_members WHERE contest_id = c_free AND role = 'owner' AND status = 'active'), 1);
  PERFORM pg_temp.eq('historique d''état créé', (SELECT count(*) FROM contest_status_history WHERE contest_id = c_free), 1);

  INSERT INTO candidates (contest_id, name) VALUES (c_free, 'Alice') RETURNING id INTO ca;
  INSERT INTO candidates (contest_id, name) VALUES (c_free, 'Bella') RETURNING id INTO cb;
  PERFORM pg_temp.eq('numérotation automatique candidat 2', (SELECT number FROM candidates WHERE id = cb), 2);

  PERFORM pg_temp.expect_fail(format($f$UPDATE contests SET status='closed' WHERE id=%L$f$, c_free), 'Transition interdite');
  UPDATE contests SET rules = NULL WHERE id = c_free;
  PERFORM pg_temp.expect_fail(format($f$UPDATE contests SET status='active' WHERE id=%L$f$, c_free), 'règlement');
  UPDATE contests SET rules = 'Règlement officiel' WHERE id = c_free;
  UPDATE contests SET status = 'active' WHERE id = c_free;
  PERFORM pg_temp.eq('concours activé', (SELECT count(*) FROM contests WHERE id = c_free AND status = 'active' AND activated_at IS NOT NULL), 1);
  PERFORM pg_temp.expect_fail(format($f$UPDATE contests SET slug='autre-slug' WHERE id=%L$f$, c_free), 'verrouillés');
  PERFORM pg_temp.expect_fail(format($f$UPDATE contests SET max_choices_per_vote=3 WHERE id=%L$f$, c_free), 'verrouillés');
  PERFORM pg_temp.expect_fail(format($f$DELETE FROM candidates WHERE id=%L$f$, ca), 'non supprimable');
  PERFORM pg_temp.expect_fail(format($f$DELETE FROM contests WHERE id=%L$f$, c_free), 'brouillons');

  -- ============ VOTE GRATUIT ============
  INSERT INTO vote_orders (contest_id, kind, votes_count, voter_phone_hash, voter_phone_masked, expires_at)
    VALUES (c_free, 'free', 1, sha256('+237691000001'::bytea), '+237 6** *** *01', now() + interval '15 min') RETURNING id INTO o;
  INSERT INTO vote_order_choices (order_id, contest_id, candidate_id, quantity) VALUES (o, c_free, ca, 1);
  res := confirm_free_order(o);
  PERFORM pg_temp.eq('vote gratuit compté', (SELECT valid_votes FROM candidate_vote_counts WHERE candidate_id = ca), 1);
  res := confirm_free_order(o);
  PERFORM pg_temp.eq('confirmation gratuite rejouable sans doublon', (SELECT valid_votes FROM candidate_vote_counts WHERE candidate_id = ca), 1);
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO vote_orders (contest_id,kind,votes_count,voter_phone_hash,expires_at)
      VALUES (%L,'free',1,sha256('+237691000001'::bytea),now()+interval '15 min')$f$, c_free), 'Quota de votes gratuits');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO vote_orders (contest_id,kind,votes_count,unit_price_xaf,subtotal_xaf,total_xaf,commission_rate_bps,commission_xaf,creator_net_xaf,expires_at)
      VALUES (%L,'paid',1,100,100,100,800,8,92,now()+interval '15 min')$f$, c_free), 'pas de votes payants');

  -- ============ VOTE PAYANT ============
  INSERT INTO contests (owner_id, name, slug, rules, vote_type, vote_price_xaf, max_choices_per_vote)
    VALUES (u_owner, 'Awards Payant', 'awards-payant', 'Règlement', 'paid', 100, 2) RETURNING id INTO c_paid;
  INSERT INTO candidates (contest_id, name) VALUES (c_paid, 'Chantal') RETURNING id INTO pa;
  INSERT INTO candidates (contest_id, name) VALUES (c_paid, 'Dieudonné') RETURNING id INTO pb;
  UPDATE contests SET status = 'active' WHERE id = c_paid;
  PERFORM pg_temp.expect_fail(format($f$UPDATE contests SET vote_price_xaf=1 WHERE id=%L$f$, c_paid), 'verrouillés');

  -- arithmétique de commission contrôlée par la base : 1000 + 25 de frais, commission 8 % = 80, créateur 920
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO vote_orders (contest_id,kind,votes_count,unit_price_xaf,subtotal_xaf,fee_xaf,total_xaf,commission_rate_bps,commission_xaf,creator_net_xaf,expires_at)
      VALUES (%L,'paid',10,100,1000,25,1025,800,70,930,now()+interval '15 min')$f$, c_paid), 'orders_amounts');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO vote_orders (contest_id,kind,votes_count,unit_price_xaf,subtotal_xaf,fee_xaf,total_xaf,commission_rate_bps,commission_xaf,creator_net_xaf,expires_at)
      VALUES (%L,'paid',10,90,900,0,900,800,72,828,now()+interval '15 min')$f$, c_paid), 'Prix unitaire');

  INSERT INTO vote_orders (contest_id, kind, votes_count, unit_price_xaf, subtotal_xaf, fee_xaf, total_xaf, commission_rate_bps, commission_xaf, creator_net_xaf, expires_at)
    VALUES (c_paid, 'paid', 10, 100, 1000, 25, 1025, 800, 80, 920, now() + interval '15 min') RETURNING id INTO o;
  INSERT INTO vote_order_choices (order_id, contest_id, candidate_id, quantity) VALUES (o, c_paid, pa, 7), (o, c_paid, pb, 3);

  PERFORM pg_temp.expect_fail(format($f$INSERT INTO payments (order_id,provider,method,provider_reference,amount_xaf,fee_xaf) VALUES (%L,'cinetpay','mtn_momo','CP-X',1000,25)$f$, o), 'Montant du paiement');
  PERFORM pg_temp.expect_fail(format($f$UPDATE vote_orders SET status='confirmed' WHERE id=%L$f$, o), 'aucun paiement réussi');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO votes (order_id,contest_id,candidate_id,quantity) VALUES (%L,%L,%L,10)$f$, o, c_paid, pa), 'Aucun vote sans commande confirmée');

  INSERT INTO payments (order_id, provider, method, provider_reference, amount_xaf, fee_xaf, payer_phone_masked)
    VALUES (o, 'cinetpay', 'mtn_momo', 'CP-1001', 1025, 25, '+237 6** *** *22') RETURNING id INTO pay;
  res := confirm_payment_and_votes(pay, 'CP-1001');
  PERFORM pg_temp.eq('paiement confirmé -> statut', (res ->> 'status' = 'confirmed')::int, 1);
  PERFORM pg_temp.eq('votes candidat A', (SELECT valid_votes FROM candidate_vote_counts WHERE candidate_id = pa), 7);
  PERFORM pg_temp.eq('votes candidat B', (SELECT valid_votes FROM candidate_vote_counts WHERE candidate_id = pb), 3);
  PERFORM pg_temp.eq('ledger : compte transit débité 1025', pg_temp.bal('CLEARING:cinetpay') - b_clear, 1025);
  PERFORM pg_temp.eq('ledger : commission 80', pg_temp.bal('REVENUE:COMMISSION') - b_comm, 80);
  PERFORM pg_temp.eq('ledger : frais agrégateur 25', pg_temp.bal('LIABILITY:PROVIDER_FEES') - b_fees, 25);
  PERFORM pg_temp.eq('ledger : solde créateur 920', (SELECT balance_xaf FROM ledger_balances WHERE owner_user_id = u_owner), 920);

  res := confirm_payment_and_votes(pay, 'CP-1001');      -- webhook rejoué
  PERFORM pg_temp.eq('webhook rejoué -> already_confirmed', (res ->> 'status' = 'already_confirmed')::int, 1);
  PERFORM pg_temp.eq('aucun doublon de votes', (SELECT sum(valid_votes) FROM candidate_vote_counts WHERE contest_id = c_paid), 10);
  PERFORM pg_temp.eq('aucun doublon comptable', (SELECT count(*) FROM ledger_transactions WHERE payment_id = pay), 1);
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO payments (order_id,provider,method,provider_reference,status,amount_xaf,fee_xaf) VALUES (%L,'notchpay','orange_money','NP-1','succeeded',1025,25)$f$, o), 'uq_payment_one_success_per_order');

  -- ============ IMMUABILITÉ ============
  PERFORM pg_temp.expect_fail($f$UPDATE ledger_entries SET amount_xaf = 1$f$, 'immuable');
  PERFORM pg_temp.expect_fail($f$DELETE FROM ledger_transactions$f$, 'immuable');
  PERFORM pg_temp.expect_fail($f$DELETE FROM votes$f$, 'immuable');
  PERFORM pg_temp.expect_fail($f$UPDATE votes SET quantity = 99$f$, 'pas modifiable');
  PERFORM audit(u_owner, 'system', 'test.event', 'test', '1');
  PERFORM pg_temp.expect_fail($f$DELETE FROM audit_logs$f$, 'immuable');

  -- ============ RETRAITS ============
  INSERT INTO creator_kyc (user_id, type, legal_name, id_document_type, id_document_key, payout_method, payout_phone, payout_account_name, status)
    VALUES (u_owner, 'individual', 'Créateur Test', 'cni', 'kyc/cni-001', 'mtn_momo', '+237691000009', 'Créateur Test', 'approved') RETURNING id INTO kyc;
  PERFORM pg_temp.eq('statut KYC synchronisé', (SELECT count(*) FROM users WHERE id = u_owner AND kyc_status = 'approved'), 1);
  PERFORM pg_temp.eq('rien de retirable avant la clôture', creator_withdrawable_xaf(u_owner), 0);

  UPDATE contests SET status = 'closed' WHERE id = c_paid;
  PERFORM pg_temp.eq('rien de retirable pendant le délai de sécurité', creator_withdrawable_xaf(u_owner), 0);
  UPDATE contests SET closed_at = now() - interval '80 hours' WHERE id = c_paid;
  PERFORM pg_temp.eq('920 retirables après le délai', creator_withdrawable_xaf(u_owner), 920);

  PERFORM pg_temp.expect_fail(format($f$INSERT INTO payouts (user_id,kyc_id,amount_xaf,fee_xaf,net_xaf,method,destination_phone_masked,twofa_verified_at) VALUES (%L,%L,900,15,885,'mtn_momo','+237 6** *** *09',now())$f$, u_owner, kyc), 'seuil minimum');
  UPDATE platform_settings SET value = '500' WHERE key = 'min_payout_xaf';
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO payouts (user_id,kyc_id,amount_xaf,fee_xaf,net_xaf,method,destination_phone_masked,twofa_verified_at) VALUES (%L,%L,1000,15,985,'mtn_momo','+237 6** *** *09',now())$f$, u_owner, kyc), 'solde retirable');
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO payouts (user_id,kyc_id,amount_xaf,fee_xaf,net_xaf,method,destination_phone_masked,twofa_verified_at) VALUES (%L,%L,900,15,885,'orange_money','+237 6** *** *09',now())$f$, u_owner, kyc), 'moyen de retrait');
  INSERT INTO payouts (user_id, kyc_id, amount_xaf, fee_xaf, net_xaf, method, destination_phone_masked, twofa_verified_at)
    VALUES (u_owner, kyc, 900, 15, 885, 'mtn_momo', '+237 6** *** *09', now()) RETURNING id INTO po;
  PERFORM pg_temp.eq('retrait en cours déduit du retirable', creator_withdrawable_xaf(u_owner), 20);
  res := complete_payout(po, 'cinetpay', 'PO-1');
  res := complete_payout(po, 'cinetpay', 'PO-1');
  PERFORM pg_temp.eq('solde créateur après retrait', (SELECT balance_xaf FROM ledger_balances WHERE owner_user_id = u_owner), 20);
  PERFORM pg_temp.eq('retrait comptabilisé une seule fois', (SELECT count(*) FROM ledger_transactions WHERE payout_id = po), 1);
  PERFORM pg_temp.eq('audit des retraits écrit', ((SELECT count(*) FROM audit_logs WHERE object_type = 'payouts') >= 1)::int, 1);

  -- ============ FICHIERS TÉLÉVERSÉS (migration 010) ============
  INSERT INTO uploads (key, owner_user_id, visibility, purpose, content_type, size_bytes)
    VALUES (md5('img-' || u_owner::text) || '.webp', u_owner, 'public', 'candidate_image', 'image/webp', 1234);
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO uploads (key, owner_user_id, visibility, purpose, content_type, size_bytes)
      VALUES (md5('kyc-1') || '.pdf', %L, 'public', 'kyc_id', 'application/pdf', 10)$f$, u_owner), 'uploads_kyc_is_private');      -- une pièce KYC ne peut pas être publique
  PERFORM pg_temp.expect_fail(format($f$INSERT INTO uploads (key, owner_user_id, visibility, purpose, content_type, size_bytes)
      VALUES ('../../etc/passwd', %L, 'public', 'candidate_image', 'image/webp', 10)$f$, u_owner), 'uploads_key_format');         -- clé de fichier invalide
  PERFORM pg_temp.expect_fail($f$UPDATE uploads SET visibility = 'public'$f$, 'immuable');
  -- (la suppression reste possible : effacement à la demande d'un utilisateur, nettoyage des fichiers orphelins)

  -- ============ PAIEMENT TARDIF APRÈS CLÔTURE -> REMBOURSEMENT ============
  INSERT INTO contests (owner_id, name, slug, rules, vote_type, vote_price_xaf) VALUES (u_owner, 'Concours Tardif', 'concours-tardif', 'R', 'paid', 200) RETURNING id INTO c_late;
  INSERT INTO candidates (contest_id, name) VALUES (c_late, 'L1') RETURNING id INTO la;
  INSERT INTO candidates (contest_id, name) VALUES (c_late, 'L2') RETURNING id INTO lb;
  UPDATE contests SET status = 'active' WHERE id = c_late;
  INSERT INTO vote_orders (contest_id, kind, votes_count, unit_price_xaf, subtotal_xaf, fee_xaf, total_xaf, commission_rate_bps, commission_xaf, creator_net_xaf, expires_at)
    VALUES (c_late, 'paid', 5, 200, 1000, 20, 1020, 800, 80, 920, now() + interval '15 min') RETURNING id INTO o2;
  INSERT INTO vote_order_choices (order_id, contest_id, candidate_id, quantity) VALUES (o2, c_late, la, 5);
  INSERT INTO payments (order_id, provider, method, provider_reference, amount_xaf, fee_xaf) VALUES (o2, 'cinetpay', 'orange_money', 'CP-2002', 1020, 20) RETURNING id INTO pay2;
  UPDATE contests SET status = 'closed' WHERE id = c_late;
  UPDATE contests SET closed_at = now() - interval '2 hours' WHERE id = c_late;      -- hors délai de grâce (15 min)
  res := confirm_payment_and_votes(pay2, 'CP-2002');
  PERFORM pg_temp.eq('paiement tardif -> needs_refund', (res ->> 'status' = 'needs_refund')::int, 1);
  PERFORM pg_temp.eq('aucun vote compté', coalesce((SELECT sum(valid_votes) FROM candidate_vote_counts WHERE contest_id = c_late), 0), 0);
  PERFORM pg_temp.eq('argent en attente de remboursement', pg_temp.bal('LIABILITY:REFUNDS_DUE') - b_refund, 1020);
  PERFORM refund_payment(pay2, u_owner, 'concours clos');
  PERFORM pg_temp.eq('remboursement soldé', pg_temp.bal('LIABILITY:REFUNDS_DUE') - b_refund, 0);

  -- ============ REMBOURSEMENT D'UN PAIEMENT NORMAL + FRAUDE ============
  PERFORM refund_payment(pay, u_owner, 'fraude avérée');
  PERFORM pg_temp.eq('votes invalidés après remboursement', coalesce((SELECT sum(valid_votes) FROM candidate_vote_counts WHERE contest_id = c_paid), 0), 0);
  PERFORM pg_temp.eq('commission annulée', pg_temp.bal('REVENUE:COMMISSION') - b_comm, 0);

  SELECT id INTO v_vote FROM votes WHERE order_id = (SELECT id FROM vote_orders WHERE contest_id = c_free LIMIT 1);
  PERFORM pg_temp.expect_fail(format($f$SELECT invalidate_vote(%s, %L, '')$f$, v_vote, u_owner), 'Motif');
  PERFORM invalidate_vote(v_vote, u_owner, 'numéros suspects');
  PERFORM pg_temp.eq('vote gratuit invalidé retiré du compteur', (SELECT valid_votes FROM candidate_vote_counts WHERE candidate_id = ca), 0);
  PERFORM pg_temp.eq('reconcile = compteurs', reconcile_vote_counts(c_free), 0);

  -- ============ INTÉGRITÉ GLOBALE (équivalent d'un COMMIT : déclenche tous les contrôles différés) ============
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM pg_temp.eq('ledger équilibré (débits = crédits)', (SELECT imbalance_xaf FROM ledger_integrity), 0);
  RAISE NOTICE 'TOUS LES TESTS PASSENT';
END $$;

-- Écriture comptable déséquilibrée : refusée à la validation
DO $$
DECLARE t uuid; a uuid := ledger_account('TEST:A', 'asset'); b uuid := ledger_account('TEST:B', 'liability');
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO ledger_transactions (kind, description, idempotency_key) VALUES ('adjustment', 'test', 'test:unbalanced') RETURNING id INTO t;
  BEGIN
    INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_xaf) VALUES (t, a, 'debit', 100), (t, b, 'credit', 90);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Le déséquilibre aurait dû être refusé';
  EXCEPTION WHEN integrity_constraint_violation THEN
    RAISE NOTICE 'OK   transaction comptable déséquilibrée refusée';
  END;
END $$;

ROLLBACK;
