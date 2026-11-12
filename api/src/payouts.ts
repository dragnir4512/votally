import { q, withTx } from './db.js';
import { defaultPayoutProvider } from './providers.js';

/**
 * Envoie un retrait à l'agrégateur puis enregistre le résultat.
 * La référence envoyée est l'identifiant du retrait : un nouvel appel (après une coupure réseau) ne paie jamais deux fois.
 * L'écriture comptable n'est passée qu'au succès (complete_payout) ; tant que le retrait est en cours, le solde correspondant est réservé.
 */
export async function dispatchPayout(payoutId: string): Promise<string> {
  const row = (await q(
    `SELECT p.id, p.status, p.net_xaf, p.method, k.payout_phone, k.payout_account_name
       FROM payouts p JOIN creator_kyc k ON k.id = p.kyc_id WHERE p.id = $1`, [payoutId])).rows[0];
  if (!row || !['requested', 'processing'].includes(row.status)) return row?.status ?? 'unknown';
  const provider = defaultPayoutProvider();

  let r;
  try {
    r = await provider.disburse({ reference: row.id, amountXaf: row.net_xaf, method: row.method, phone: row.payout_phone, name: row.payout_account_name });
  } catch (e) {
    console.error('[retrait] appel agrégateur incertain, vérification ultérieure', row.id, (e as Error).message);
    return 'requested';                                         // le job settlePayouts() vérifiera avant tout renvoi
  }
  return applyPayoutResult(row.id, provider.name, r);
}

async function applyPayoutResult(id: string, providerName: string, r: { status: string; providerReference?: string; reason?: string }): Promise<string> {
  if (r.status === 'succeeded') {
    await withTx(null, (c) => c.query('SELECT complete_payout($1, $2, $3)', [id, providerName, r.providerReference ?? id]));
    return 'succeeded';
  }
  if (r.status === 'failed') {
    await q(`UPDATE payouts SET status = 'failed', failure_reason = $2, provider = $3, completed_at = now() WHERE id = $1 AND status IN ('requested','processing')`,
      [id, (r.reason ?? 'Refusé par l\'agrégateur').slice(0, 300), providerName]);
    return 'failed';
  }
  await q(`UPDATE payouts SET status = 'processing', provider = $2, provider_reference = COALESCE($3, provider_reference)
            WHERE id = $1 AND status IN ('requested','processing')`, [id, providerName, r.providerReference ?? null]);
  return 'processing';
}

/** Tâche de fond : règle les retraits restés en cours ou incertains. Idempotent. */
export async function settlePayouts(olderThanSeconds = 30): Promise<{ checked: number; settled: number }> {
  const provider = defaultPayoutProvider();
  const rows = (await q(
    `SELECT id, status FROM payouts WHERE status IN ('requested','processing') AND requested_at < now() - make_interval(secs => $1::int) ORDER BY requested_at LIMIT 50`,
    [olderThanSeconds])).rows;
  let settled = 0;
  for (const p of rows) {
    try {
      const v = await provider.verifyPayout(p.id);
      if (v.status === 'unknown') { if (p.status === 'requested') { await dispatchPayout(p.id); settled++; } continue; }   // jamais parti : on envoie (même référence)
      if (v.status === 'processing') continue;
      await applyPayoutResult(p.id, provider.name, v); settled++;
    } catch (e) { console.error('[retrait] règlement impossible', p.id, (e as Error).message); }
  }
  return { checked: rows.length, settled };
}
