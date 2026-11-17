
CREATE OR REPLACE FUNCTION fail_payment(
  p_payment uuid,
  p_reason text,
  p_expired boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  pay payments%ROWTYPE;
  has_open_payment boolean;
BEGIN
  SELECT *
    INTO pay
    FROM payments
   WHERE id = p_payment
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable : %', p_payment;
  END IF;

  IF pay.status IN ('succeeded', 'refunded', 'failed', 'expired') THEN
    RETURN;
  END IF;

  UPDATE payments
     SET status = CASE WHEN p_expired THEN 'expired' ELSE 'failed' END,
         failure_reason = p_reason,
         completed_at = now()
   WHERE id = pay.id;

  -- Vérifier si une autre tentative de paiement est encore ouverte.
  SELECT EXISTS (
    SELECT 1
      FROM payments
     WHERE order_id = pay.order_id
       AND id <> pay.id
       AND status IN ('initiated', 'pending')
  )
  INTO has_open_payment;

  -- Ne pas modifier une commande déjà confirmée ou remboursée.
  IF has_open_payment THEN
    RETURN;
  END IF;

  UPDATE vote_orders
     SET status = CASE WHEN p_expired THEN 'expired' ELSE 'failed' END
   WHERE id = pay.order_id
     AND status = 'pending';
END;
$$;
