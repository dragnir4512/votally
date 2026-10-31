'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { dateTime, PAYOUT_STATUS, xaf, type Balance, type PayoutRow } from '../../lib/creator';

export default function PayoutPanel({ payoutPhone }: { payoutPhone: string }) {
  const [bal, setBal] = useState<Balance | null>(null); const [rows, setRows] = useState<PayoutRow[]>([]);
  const [amount, setAmount] = useState(''); const [quote, setQuote] = useState<{ feeXaf: number; netXaf: number } | null>(null);
  const [step, setStep] = useState<'amount' | 'code'>('amount'); const [code, setCode] = useState(''); const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const amountN = Number(amount.replace(/\s/g, '')) || 0;

  const load = useCallback(async () => {
    const [b, p] = await Promise.all([api<{ balance: Balance }>('/me/balance'), api<{ payouts: PayoutRow[] }>('/payouts')]);
    setBal(b.balance); setRows(p.payouts);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => {
    if (!amountN || step !== 'amount') { setQuote(null); return; }
    let alive = true; const id = setTimeout(() => api<{ feeXaf: number; netXaf: number }>(`/payouts/quote?amountXaf=${amountN}`).then((q) => alive && setQuote(q)).catch(() => alive && setQuote(null)), 250);
    return () => { alive = false; clearTimeout(id); };
  }, [amountN, step]);

  const guard = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Erreur'); } finally { setBusy(false); } };
  const ask = () => guard(async () => { const r = await api<{ devCode?: string }>('/payouts/otp', { body: {} }); setDevCode(r.devCode ?? null); setStep('code'); });
  const confirm = () => guard(async () => {
    const r = await api<{ payout: { status: string; netXaf: number } }>('/payouts', { body: { amountXaf: amountN, code } });
    setDone(r.payout.status === 'failed' ? 'Le retrait a été refusé par l\'opérateur. Aucun montant n\'a été débité.' : r.payout.status === 'succeeded'
      ? `${xaf(r.payout.netXaf)} envoyés sur ton compte Mobile Money.` : 'Retrait en cours de traitement : il apparaîtra dans l\'historique dès confirmation.');
    setStep('amount'); setAmount(''); setCode(''); await load();
  });

  if (!bal) return <p className="muted">Chargement…</p>;
  const canAsk = amountN >= bal.minPayoutXaf && amountN <= bal.withdrawableXaf;
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{xaf(bal.withdrawableXaf)}</b><span>retirable maintenant</span></div>
        <div className="stat"><b>{xaf(bal.lockedXaf)}</b><span>en attente de clôture (+{bal.delayHours} h)</span></div>
        <div className="stat"><b>{xaf(bal.inFlightXaf)}</b><span>retraits en cours</span></div>
      </div>
      <div className="panel">
        <h3>Retirer mon argent</h3>
        <p className="muted small">Les fonds d&apos;un concours sont retirables {bal.delayHours} h après sa clôture. Minimum : {xaf(bal.minPayoutXaf)}. Envoi sur {payoutPhone}.</p>
        {done && <p className="notice" role="status">{done}</p>}
        {step === 'amount' ? (
          <>
            <label className="field"><span>Montant à retirer (FCFA)</span><input className="input" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d\s]/g, '')); setDone(null); }} placeholder={String(bal.minPayoutXaf)} /></label>
            {quote && amountN > 0 && <p className="small">Frais de retrait : <strong>{xaf(quote.feeXaf)}</strong> · Tu reçois : <strong>{xaf(quote.netXaf)}</strong></p>}
            {amountN > 0 && !canAsk && <p className="error small">{amountN < bal.minPayoutXaf ? `Le minimum est de ${xaf(bal.minPayoutXaf)}.` : 'Montant supérieur à ton solde retirable.'}</p>}
            <button className="btn btn-primary" type="button" disabled={busy || !canAsk} onClick={ask}>Recevoir un code de confirmation par SMS</button>
          </>
        ) : (
          <>
            <p className="muted">Code envoyé au numéro de ton compte Mobile Money.</p>
            {devCode && <p className="devhint">Mode test : code {devCode}</p>}
            <input className="input code" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code de confirmation" />
            <div className="actions"><button className="btn btn-primary" type="button" disabled={busy || code.length !== 6} onClick={confirm}>Confirmer le retrait de {xaf(amountN)}</button>
              <button className="btn btn-link" type="button" onClick={() => { setStep('amount'); setCode(''); setError(null); }}>Annuler</button></div>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <h3>Historique</h3>
      <div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Statut</th></tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={5} className="muted">Aucun retrait.</td></tr>}
          {rows.map((r) => <tr key={r.id}><td>{dateTime(r.requestedAt)}</td><td>{xaf(r.amountXaf)}</td><td>{xaf(r.feeXaf)}</td><td>{xaf(r.netXaf)}</td>
            <td>{PAYOUT_STATUS[r.status]}{r.failureReason && <div className="muted small">{r.failureReason}</div>}</td></tr>)}</tbody></table></div>
    </>
  );
}
