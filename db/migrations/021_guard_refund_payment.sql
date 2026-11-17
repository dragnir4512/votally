-- 021 — Refuser les remboursements comptables sans encaissement confirmé.
-- L'endpoint admin est appelé après le remboursement externe : il ne doit jamais
-- créer une écriture inverse pour un paiement échoué, expiré ou jamais comptabilisé.

CREATE OR REPLACE FUNCTION refund_payment(
  p_payment uuid,
  p_actor uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  pay payments%ROWTYPE;
  o vote_orders%ROWTYPE;
BEGIN
  SELECT * INTO pay
    FROM payments
   WHERE id = p_payment
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable' USING ERRCODE = 'check_violation';
  END IF;

  -- Un rejeu est autorisé uniquement si l'écriture de remboursement existe déjà.
  IF pay.status = 'refunded' THEN
    IF EXISTS (
      SELECT 1 FROM ledger_transactions
       WHERE idempotency_key = 'refund:' || pay.id
    ) THEN
      RETURN ledger_post_refund(pay.id);
    END IF;
    RAISE EXCEPTION 'Remboursement déjà marqué mais écriture comptable absente'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Un paiement échoué/en attente n'a pas encaissé de fonds à rembourser.
  IF pay.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Seul un paiement confirmé peut être remboursé (statut : %)', pay.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Le paiement doit avoir été comptabilisé normalement ou placé en fonds à rembourser.
  IF NOT EXISTS (
    SELECT 1 FROM ledger_transactions
     WHERE idempotency_key IN ('payment:' || pay.id, 'unallocated:' || pay.id)
  ) THEN
    RAISE EXCEPTION 'Aucune écriture d''encaissement correspondante : remboursement bloqué'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE payments
     SET status = 'refunded',
         needs_refund = false
   WHERE id = pay.id;

  SELECT * INTO o
    FROM vote_orders
   WHERE id = pay.order_id
   FOR UPDATE;

  IF o.status = 'confirmed' THEN
    UPDATE votes
       SET is_valid = false,
           invalidated_at = now(),
           invalidated_by = p_actor,
           invalidation_reason = 'Remboursement : ' || COALESCE(p_reason, '')
     WHERE order_id = o.id
       AND is_valid;

    UPDATE vote_orders
       SET status = 'refunded'
     WHERE id = o.id;
  END IF;

  RETURN ledger_post_refund(pay.id);
END;
$$;
