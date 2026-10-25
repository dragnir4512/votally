import { Router } from 'express';
import { ah, HttpError } from '../http.js';
import { q, withTx } from '../db.js';
import { getPaymentProvider } from '../providers.js';

export const webhooksRouter = Router();

/**
 * Webhook d'agrégateur. Corps BRUT (express.raw) pour vérifier la signature.
 * Étapes : signature -> anti-rejeu -> vérification serveur à serveur -> confirmation atomique en base.
 */
webhooksRouter.post('/payments/:provider', ah(async (req, res) => {
  const provider = getPaymentProvider(req.params.provider as string);
  if (!provider) throw new HttpError(404, 'Agrégateur inconnu', 'not_found');
  const raw: Buffer = req.body;
  if (!Buffer.isBuffer(raw) || !provider.verifyWebhookSignature(raw, req.header('x-signature') ?? undefined)) {
    throw new HttpError(401, 'Signature invalide', 'bad_signature');
  }
  let payload: any;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide', 'bad_json'); }
  const evt = provider.parseWebhook(payload);

  // Anti-rejeu : un événement déjà TRAITÉ est ignoré ; un événement reçu mais non traité est retenté
  const ins = await q(
    `INSERT INTO webhook_events (provider, event_id, signature_valid, payload) VALUES ($1,$2,true,$3)
     ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`, [provider.name, evt.eventId, payload]);
  let eventRowId: number | undefined = ins.rows[0]?.id;
  if (!eventRowId) {
    const ex = (await q('SELECT id, processed_at FROM webhook_events WHERE provider = $1 AND event_id = $2', [provider.name, evt.eventId])).rows[0];
    if (ex.processed_at) return res.json({ received: true, duplicate: true });
    eventRowId = ex.id;
  }

  try {
    const pay = (await q('SELECT id, amount_xaf FROM payments WHERE provider = $1 AND provider_reference = $2', [provider.name, evt.providerReference])).rows[0];
    if (!pay) throw new Error('Paiement inconnu pour cette référence');

    const v = await provider.verify(evt.providerReference);                       // on ne croit pas le webhook sur parole
    let outcome = v.status as string;
    if (v.status === 'succeeded') {
      if (v.amountXaf !== undefined && v.amountXaf !== pay.amount_xaf) throw new Error(`Montant incohérent : ${v.amountXaf} reçu, ${pay.amount_xaf} attendu`);
      const r = await withTx(null, (c) => c.query('SELECT confirm_payment_and_votes($1, $2) AS r', [pay.id, evt.providerReference]));
      outcome = r.rows[0].r.status;                                                // confirmed | already_confirmed | needs_refund
    } else if (v.status === 'failed' || v.status === 'expired') {
      await q('SELECT fail_payment($1, $2, $3)', [pay.id, `Agrégateur : ${v.status}`, v.status === 'expired']);
    }
    await q('UPDATE webhook_events SET processed_at = now(), processing_error = NULL WHERE id = $1', [eventRowId]);
    res.json({ received: true, outcome });
  } catch (e: any) {
    await q('UPDATE webhook_events SET processing_error = $2 WHERE id = $1', [eventRowId, String(e.message).slice(0, 500)]);
    throw e;     // 500 : l'agrégateur réessaiera, et l'événement non traité sera retenté
  }
}));
