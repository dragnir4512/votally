-- 022 — Comptabiliser séparément le transfert net et les frais de retrait.
-- Le créateur est débité du montant brut ; le prestataire ne reçoit que le net.
-- Les frais retenus sont portés au compte de frais dus au prestataire.

CREATE OR REPLACE FUNCTION complete_payout(
  p_payout uuid,
  p_provider text,
  p_provider_reference text
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  po payouts%ROWTYPE;
  v_tx uuid;
BEGIN
  SELECT * INTO po
    FROM payouts
   WHERE id = p_payout
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retrait introuvable';
  END IF;

  IF po.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF po.status = 'requested' THEN
    UPDATE payouts SET status = 'processing' WHERE id = po.id;
  END IF;

  UPDATE payouts
     SET status = 'succeeded',
         provider = p_provider,
         provider_reference = p_provider_reference,
         completed_at = now()
   WHERE id = po.id;

  INSERT INTO ledger_transactions (kind, payout_id, description, idempotency_key)
  VALUES ('payout', po.id, 'Retrait ' || po.id, 'payout:' || po.id)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx;

  IF v_tx IS NOT NULL THEN
    -- Débit du solde créateur : montant brut demandé.
    PERFORM ledger_add(
      v_tx,
      ledger_account('LIABILITY:CREATOR:' || po.user_id, 'liability', po.user_id),
      NULL,
      'debit',
      po.amount_xaf
    );

    -- Sortie de trésorerie : seul le montant net est transféré au bénéficiaire.
    PERFORM ledger_add(
      v_tx,
      ledger_account('CLEARING:' || p_provider, 'asset', NULL, p_provider),
      NULL,
      'credit',
      po.net_xaf
    );

    -- Les frais retenus restent identifiés comme montant dû au prestataire.
    PERFORM ledger_add(
      v_tx,
      ledger_account('LIABILITY:PROVIDER_FEES', 'liability'),
      NULL,
      'credit',
      po.fee_xaf
    );
  END IF;

  RETURN jsonb_build_object('status', 'completed', 'net_xaf', po.net_xaf);
END;
$$;
