
import { Router } from 'express';
import { ah, HttpError } from '../http.js';
import { q, withTx } from '../db.js';
import { getPaymentProvider, type PaymentProvider } from '../providers.js';

export const webhooksRouter = Router();

/**
 * Vérifie un paiement directement auprès de son agrégateur
 * et confirme les votes si le paiement est réellement réussi.
 *
 * Cette fonction est partagée entre les webhooks et la vérification manuelle.
 */
export async function reconcileProviderPayment(
  provider: PaymentProvider,
  providerReference: string,
) {
  const pay = (await q(
    `SELECT id, amount_xaf, status
     FROM payments
     WHERE provider = $1 AND provider_reference = $2`,
    [provider.name, providerReference],
  )).rows[0];

  if (!pay) {
    throw new Error('Paiement inconnu pour cette référence.');
  }

  const verification = await provider.verify(providerReference);

  if (verification.status === 'succeeded') {
    if (
      !Number.isSafeInteger(verification.amountXaf)
      || verification.amountXaf !== Number(pay.amount_xaf)
    ) {
      throw new Error(
        `Montant absent ou incohérent : ${verification.amountXaf ?? 'non fourni'} reçu, ${pay.amount_xaf} attendu.`,
      );
    }

    const result = await withTx(null, (cx) =>
      cx.query(
        'SELECT confirm_payment_and_votes($1, $2) AS r',
        [pay.id, providerReference],
      ),
    );

    return {
      received: true,
      outcome: result.rows[0].r.status,
      paymentStatus: 'succeeded' as const,
    };
  }

  if (
    verification.status === 'failed'
    || verification.status === 'expired'
  ) {
    await q(
      'SELECT fail_payment($1, $2, $3)',
      [
        pay.id,
        `Agrégateur : ${verification.status}`,
        verification.status === 'expired',
      ],
    );
  }

  return {
    received: true,
    outcome: verification.status,
    paymentStatus: verification.status,
  };
}

/**
 * Traite un événement d'agrégateur.
 * Anti-rejeu -> vérification serveur à serveur -> confirmation atomique.
 */
export async function handleProviderEvent(
  provider: PaymentProvider,
  eventId: string,
  providerReference: string,
  payload: unknown,
) {
  const ins = await q(
    `INSERT INTO webhook_events (provider, event_id, signature_valid, payload)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [provider.name, eventId, payload],
  );

  let eventRowId: number | undefined = ins.rows[0]?.id;

  if (!eventRowId) {
    const existing = (
      await q(
        `SELECT id, processed_at
         FROM webhook_events
         WHERE provider = $1 AND event_id = $2`,
        [provider.name, eventId],
      )
    ).rows[0];

    if (existing.processed_at) {
      return { received: true, duplicate: true as const };
    }

    eventRowId = existing.id;
  }

  try {
    const result = await reconcileProviderPayment(
      provider,
      providerReference,
    );

    await q(
      `UPDATE webhook_events
       SET processed_at = now(), processing_error = NULL
       WHERE id = $1`,
      [eventRowId],
    );

    return result;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    await q(
      'UPDATE webhook_events SET processing_error = $2 WHERE id = $1',
      [eventRowId, message.slice(0, 500)],
    );

    throw error;
  }
}

/** Webhook d'agrégateur. Corps brut pour vérifier la signature. */
webhooksRouter.post(
  '/payments/:provider',
  ah(async (req, res) => {
    const provider = getPaymentProvider(
      req.params.provider as string,
    );

    if (!provider) {
      throw new HttpError(404, 'Agrégateur inconnu', 'not_found');
    }

    const raw: Buffer = req.body;

    const signatureHeader = provider.name === 'notchpay'
      ? 'x-notch-signature'
      : 'x-signature';

    if (
      !Buffer.isBuffer(raw)
      || !provider.verifyWebhookSignature(
        raw,
        req.header(signatureHeader) ?? undefined,
      )
    ) {
      throw new HttpError(401, 'Signature invalide', 'bad_signature');
    }

    let payload: any;

    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON invalide', 'bad_json');
    }

    const event = provider.parseWebhook(payload);

    res.json(
      await handleProviderEvent(
        provider,
        event.eventId,
        event.providerReference,
        payload,
      ),
    );
  }),
);
