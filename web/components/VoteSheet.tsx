'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/client';
import { distribute, formatXaf, uuid, validPhone } from '../lib/format';
import type { T } from '../lib/i18n';
import type { Candidate, ContestPublic, Lang, Pack, PayMethod } from '../lib/types';
import ShareBar from './ShareBar';

type Step = 'form' | 'code' | 'pending' | 'done' | 'failed';
interface Quote { votes: number; subtotalXaf: number; feeXaf: number; totalXaf: number }
interface Order { reference: string; totalXaf: number; expiresAt: string }

export default function VoteSheet({ contest, packs, selected, lang, tt, shareUrl, onClose }:
  { contest: ContestPublic; packs: Pack[]; selected: Candidate[]; lang: Lang; tt: T; shareUrl: string; onClose: () => void }) {
  const { t, err } = tt;
  const slug = contest.slug;
  const canFree = contest.voteType !== 'paid';
  const canPaid = contest.voteType !== 'free';
  const [mode, setMode] = useState<'free' | 'paid'>(canFree ? 'free' : 'paid');
  const [step, setStep] = useState<Step>('form');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>('mtn_momo');
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(selected.map((c) => [c.id, 1])));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(uuid());

  const totalVotes = useMemo(() => selected.reduce((s, c) => s + (qty[c.id] ?? 1), 0), [selected, qty]);
  const pack = useMemo(() => packs.find((p) => p.votesCount === totalVotes), [packs, totalVotes]);
  const choices = useMemo(() => selected.map((c) => ({ candidateId: c.id, quantity: qty[c.id] ?? 1 })), [selected, qty]);
  const needsPhone = mode === 'free' || method !== 'card';
  const phoneOk = !needsPhone || validPhone(phone);
  const freeTooMany = mode === 'free' && selected.length > contest.freeVotesPerPeriod;
  const fail = (e: unknown) => setError(e instanceof ApiError ? err(e.code, e.message) : t('genericError'));

  // Fermeture au clavier + blocage du défilement derrière la feuille
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Une nouvelle saisie = une nouvelle clé d'idempotence (un rejeu réseau garde la même clé)
  useEffect(() => { idem.current = uuid(); }, [choices, method, mode, phone]);

  // Devis (prix + frais) AVANT paiement
  useEffect(() => {
    if (mode !== 'paid' || step !== 'form') return;
    let alive = true; setQuote(null);
    const id = setTimeout(async () => {
      try {
        const q = await api<Quote>(`/public/contests/${slug}/quote`, { body: { method, packId: pack?.id, choices } });
        if (alive) { setQuote(q); setError(null); }
      } catch (e) { if (alive) fail(e); }
    }, 300);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step, method, pack?.id, choices, slug]);

  // Suivi du paiement : interrogation toutes les 3 s jusqu'à la confirmation ou l'expiration
  useEffect(() => {
    if (step !== 'pending' || !order) return;
    const id = setInterval(async () => {
      try {
        const r = await api<{ order: { status: string } }>(`/public/orders/${order.reference}`);
        if (r.order.status === 'confirmed') { setReceipt(order.reference); setStep('done'); }
        else if (['failed', 'expired', 'cancelled'].includes(r.order.status)) setStep('failed');
        else if (Date.now() > new Date(order.expiresAt).getTime() + 10_000) setStep('failed');
      } catch { /* réseau instable : on réessaie au prochain tour */ }
    }, 3000);
    return () => clearInterval(id);
  }, [step, order]);

  const guarded = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); } };

  const sendCode = () => guarded(async () => {
    const r = await api<{ devCode?: string }>(`/public/contests/${slug}/otp`, { body: { phone } });
    setDevCode(r.devCode ?? null); setStep('code');
  });
  const submitFree = () => guarded(async () => {
    const r = await api<{ reference: string }>(`/public/contests/${slug}/votes/free`,
      { body: { phone, code, choices: selected.map((c) => ({ candidateId: c.id, quantity: 1 })), locale: lang } });
    setReceipt(r.reference); setStep('done');
  });
  const submitPaid = () => guarded(async () => {
    const o = await api<Order & { status: string }>(`/public/contests/${slug}/orders`,
      { body: { method, phone: needsPhone ? phone : undefined, packId: pack?.id, choices, locale: lang }, headers: { 'Idempotency-Key': idem.current } });
    setOrder(o); setStep('pending');
  });
  const simulate = () => guarded(async () => { if (order) await api(`/dev/mock-pay/orders/${order.reference}`, { body: {} }); });

  const setQ = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.min(100000, Math.max(1, Math.floor(n) || 1)) }));
  const applyPack = (p: Pack) => { const d = distribute(p.votesCount, selected.length); if (d.length) setQty(Object.fromEntries(selected.map((c, i) => [c.id, d[i]!]))); };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('vote')}>
        <button className="x" type="button" onClick={onClose} aria-label={t('close')}>×</button>

        {step === 'done' && (
          <div className="center">
            <div className="ok">✓</div>
            <h2>{t('doneTitle')}</h2>
            <p className="muted">{t('doneBody', { ref: receipt })}</p>
            <p><strong>{t('shareTitle')}</strong></p>
            <ShareBar url={shareUrl} t={t} text={t('shareText', { name: selected.map((c) => c.name).join(', '), contest: contest.name })} />
            <button className="btn btn-primary block" type="button" onClick={onClose}>{t('close')}</button>
          </div>
        )}

        {step === 'failed' && (
          <div className="center">
            <div className="ko">!</div>
            <h2>{t('failedTitle')}</h2>
            <p className="muted">{t('failedBody')}</p>
            <button className="btn btn-primary block" type="button" onClick={() => { setStep('form'); setOrder(null); setError(null); }}>{t('retry')}</button>
          </div>
        )}

        {step === 'pending' && order && (
          <div className="center">
            <div className="spinner" aria-hidden />
            <h2>{t('pendingTitle')}</h2>
            <p className="muted">{t('pendingBody', { amount: formatXaf(order.totalXaf, lang) })}</p>
            {process.env.NEXT_PUBLIC_DEV_MOCK === '1' && (
              <button className="btn btn-outline block" type="button" disabled={busy} onClick={simulate}>{t('simulate')}</button>
            )}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        )}

        {step === 'code' && (
          <div>
            <h2>{t('vote')}</h2>
            <p className="muted">{t('codeSent', { phone })}</p>
            {devCode && <p className="devhint">{t('devCode', { code: devCode })}</p>}
            <label className="field"><span>{t('code')}</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" className="code" /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary block" type="button" disabled={busy || code.length !== 6} onClick={submitFree}>{t('confirmVote')}</button>
            <button className="btn btn-link block" type="button" onClick={() => { setStep('form'); setCode(''); setError(null); }}>{t('back')}</button>
          </div>
        )}

        {step === 'form' && (
          <div>
            <h2>{t('voteFor', { n: selected.length })}</h2>
            <p className="chips">{selected.map((c) => <span key={c.id} className="chip">#{c.number} {c.name}</span>)}</p>

            {canFree && canPaid && (
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={mode === 'free'} className={mode === 'free' ? 'on' : ''} onClick={() => { setMode('free'); setError(null); }} type="button">{t('free')}</button>
                <button role="tab" aria-selected={mode === 'paid'} className={mode === 'paid' ? 'on' : ''} onClick={() => { setMode('paid'); setError(null); }} type="button">{t('paid')}</button>
              </div>
            )}

            {mode === 'free' && <p className="muted small">{t('freeVoteInfo', { n: contest.freeVotesPerPeriod, h: contest.freeVotePeriodHours })}</p>}
            {freeTooMany && <p className="error">{t('freeLimit', { n: contest.freeVotesPerPeriod })}</p>}

            {mode === 'paid' && (
              <>
                <p className="muted small">{t('pricePerVote', { price: formatXaf(contest.votePriceXaf, lang) })}</p>
                {packs.length > 0 && (
                  <div className="packs" aria-label={t('packs')}>
                    {packs.map((p) => (
                      <button key={p.id} type="button" disabled={p.votesCount < selected.length}
                        className={`pack${pack?.id === p.id ? ' on' : ''}`} onClick={() => applyPack(p)}>
                        <strong>{p.votesCount}</strong> {t('votesWord')}<br /><small>{formatXaf(p.priceXaf, lang)}</small>
                      </button>
                    ))}
                  </div>
                )}
                {selected.map((c) => (
                  <div className="qty" key={c.id}>
                    <span className="qty-name">#{c.number} {c.name}</span>
                    <div className="stepper">
                      <button type="button" aria-label="−" onClick={() => setQ(c.id, (qty[c.id] ?? 1) - 1)}>−</button>
                      <input inputMode="numeric" aria-label={t('yourVotes')} value={qty[c.id] ?? 1} onChange={(e) => setQ(c.id, Number(e.target.value.replace(/\D/g, '')))} />
                      <button type="button" aria-label="+" onClick={() => setQ(c.id, (qty[c.id] ?? 1) + 1)}>+</button>
                    </div>
                  </div>
                ))}
                <fieldset className="methods"><legend>{t('payWith')}</legend>
                  {(['mtn_momo', 'orange_money', 'card'] as PayMethod[]).map((m) => (
                    <label key={m} className={method === m ? 'on' : ''}>
                      <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
                      {m === 'mtn_momo' ? t('momo') : m === 'orange_money' ? t('orange') : t('card')}
                    </label>
                  ))}
                </fieldset>
              </>
            )}

            {needsPhone && (
              <label className="field"><span>{t('phone')}</span>
                <div className="phone"><span className="prefix">+237</span>
                  <input type="tel" inputMode="tel" autoComplete="tel-national" value={phone} placeholder={t('phoneHelp')}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, ''))} aria-invalid={phone !== '' && !phoneOk} /></div>
                {phone !== '' && !phoneOk && <small className="error">{t('invalidPhone')}</small>}
              </label>
            )}

            {mode === 'paid' && (
              <dl className="totals">
                <div><dt>{t('subtotal')} ({totalVotes})</dt><dd>{quote ? formatXaf(quote.subtotalXaf, lang) : '…'}</dd></div>
                <div><dt>{t('fees')}</dt><dd>{quote ? formatXaf(quote.feeXaf, lang) : '…'}</dd></div>
                <div className="grand"><dt>{t('total')}</dt><dd>{quote ? formatXaf(quote.totalXaf, lang) : t('computing')}</dd></div>
              </dl>
            )}

            {error && <p className="error" role="alert">{error}</p>}

            {mode === 'free'
              ? <button className="btn btn-primary block" type="button" disabled={busy || !phoneOk || !phone || freeTooMany} onClick={sendCode}>{t('sendCode')}</button>
              : <button className="btn btn-primary block" type="button" disabled={busy || !phoneOk || (needsPhone && !phone) || !quote} onClick={submitPaid}>
                  {quote ? t('pay', { amount: formatXaf(quote.totalXaf, lang) }) : t('computing')}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
