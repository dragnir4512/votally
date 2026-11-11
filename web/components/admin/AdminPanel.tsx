'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { dateTime, xaf } from '../../lib/creator';
import { useMe } from '../../lib/session';

type Tab = 'overview' | 'kyc' | 'refunds' | 'contests' | 'fraud' | 'payouts';
const TABS: [Tab, string][] = [['overview', 'Vue d\'ensemble'], ['kyc', 'Identités'], ['refunds', 'Remboursements'], ['contests', 'Concours'], ['fraud', 'Fraude'], ['payouts', 'Retraits']];

function useList<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const load = useCallback(() => api<{ items: T[] }>(path).then((r) => setItems(r.items)).catch(() => setItems([])), [path]);
  useEffect(() => { load(); }, [load]);
  return { items, load };
}
const msg = (e: unknown) => (e instanceof ApiError ? (e.details ?? e.message) : 'Erreur');

function Overview() {
  const [o, setO] = useState<Record<string, number> | null>(null);
  useEffect(() => { api<{ overview: Record<string, number> }>('/admin/overview').then((r) => setO(r.overview)); }, []);
  if (!o) return <p className="muted">Chargement…</p>;
  const cards: [string, string, boolean][] = [['pendingKyc', 'dossiers d\'identité à examiner', o.pendingKyc > 0], ['refundsDue', 'remboursements à faire', o.refundsDue > 0],
    ['openFraudFlags', 'alertes de fraude', o.openFraudFlags > 0], ['payoutsInFlight', 'retraits en cours', false], ['payoutsFailed7d', 'retraits échoués (7 j)', o.payoutsFailed7d > 0],
    ['unprocessedWebhooks', 'notifications de paiement non traitées', o.unprocessedWebhooks > 0], ['activeContests', 'concours actifs', false]];
  return (
    <>
      <div className="stats">{cards.map(([k, label, warn]) => <div className={`stat${warn ? ' warn' : ''}`} key={k}><b>{o[k]}</b><span>{label}</span></div>)}</div>
      <p className={o.ledgerImbalanceXaf === 0 ? 'notice small' : 'error'}>{o.ledgerImbalanceXaf === 0 ? '✓ Grand livre équilibré (débits = crédits).' : `⚠ Grand livre déséquilibré de ${xaf(o.ledgerImbalanceXaf)} : à investiguer immédiatement.`}</p>
    </>
  );
}

function Kyc() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { items, load } = useList<any>(`/admin/kyc?status=${status}`);
  const [open, setOpen] = useState<{ kyc: any; documents: { label: string; key: string }[] } | null>(null);
  const [checked, setChecked] = useState(false); const [reason, setReason] = useState(''); const [error, setError] = useState<string | null>(null);
  const view = async (id: string) => { setError(null); setChecked(false); setReason(''); setOpen(await api(`/admin/kyc/${id}`)); };
  const act = async (kind: 'approve' | 'reject') => {
    try { await api(`/admin/kyc/${open!.kyc.id}/${kind}`, { body: kind === 'approve' ? { nameChecked: true } : { reason } }); setOpen(null); await load(); } catch (e) { setError(msg(e)); }
  };
  return (
    <section>
      <div className="tabs">{(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} className={status === s ? 'on' : ''} type="button" onClick={() => { setStatus(s); setOpen(null); }}>{{ pending: 'À examiner', approved: 'Validés', rejected: 'Refusés' }[s]}</button>)}</div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Titulaire</th><th>Type</th><th>Compte</th><th>Déposé</th><th /></tr></thead>
        <tbody>{items?.length === 0 && <tr><td colSpan={5} className="muted">Aucun dossier.</td></tr>}
          {items?.map((k) => <tr key={k.id}><td>{k.legalName}</td><td>{k.type === 'individual' ? 'Personne' : 'Organisation'}</td><td>{k.fullName ?? k.email ?? k.phone}</td><td>{dateTime(k.submittedAt)}</td>
            <td><button type="button" className="btn btn-outline sm" onClick={() => view(k.id)}>Examiner</button></td></tr>)}</tbody></table></div>
      {open && (
        <div className="panel">
          <h3>{open.kyc.legalName}</h3>
          <p className="small">Compte VOTALLY : {open.kyc.fullName} · {open.kyc.email ?? open.kyc.phone}<br />
            Mobile Money : <strong>{open.kyc.payoutMethod === 'mtn_momo' ? 'MTN MoMo' : 'Orange Money'} {open.kyc.payoutPhone}</strong> au nom de <strong>{open.kyc.payoutAccountName}</strong>{open.kyc.niu && <> · NIU {open.kyc.niu}</>}</p>
          <p className="small muted">Chaque ouverture d&apos;une pièce est enregistrée dans le journal d&apos;audit.</p>
          <div className="docs">{open.documents.map((d) => <a key={d.key} className="btn btn-ghost sm" href={`/api/admin/files/${d.key}`} target="_blank" rel="noopener noreferrer">Ouvrir : {d.label}</a>)}</div>
          {open.kyc.status === 'pending' && (
            <>
              <label className="check-line"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> J&apos;ai vérifié que le <strong>nom du titulaire du compte Mobile Money correspond à la pièce d&apos;identité</strong>.</label>
              <div className="actions"><button type="button" className="btn btn-primary" disabled={!checked} onClick={() => act('approve')}>Valider le dossier</button></div>
              <label className="field"><span>Ou refuser, avec un motif clair pour l&apos;utilisateur</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Photo illisible, nom différent de la pièce…" /></label>
              <button type="button" className="btn btn-ghost danger" disabled={reason.trim().length < 5} onClick={() => act('reject')}>Refuser le dossier</button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Refunds() {
  const { items, load } = useList<any>('/admin/refunds'); const [error, setError] = useState<string | null>(null);
  const done = async (id: string) => {
    const reason = window.prompt('Motif du remboursement (le votant doit déjà avoir été remboursé chez l\'agrégateur) :', 'Concours clos, remboursé via agrégateur');
    if (!reason) return;
    try { await api(`/admin/payments/${id}/refund`, { body: { reason } }); await load(); } catch (e) { setError(msg(e)); }
  };
  return (
    <section>
      <p className="muted small">Paiements encaissés dont les votes n&apos;ont pas pu être comptés. <strong>Rembourse d&apos;abord le votant chez l&apos;agrégateur</strong>, puis valide ici pour passer l&apos;écriture comptable.</p>
      <div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Concours</th><th>Commande</th><th>Montant</th><th>Agrégateur</th><th /></tr></thead>
        <tbody>{items?.length === 0 && <tr><td colSpan={6} className="muted">Rien à rembourser.</td></tr>}
          {items?.map((r) => <tr key={r.id}><td>{dateTime(r.initiatedAt)}</td><td>{r.contestName}</td><td><code>{r.orderReference}</code></td><td>{xaf(r.amountXaf)}</td><td>{r.provider} · <code>{r.providerReference}</code></td>
            <td><button type="button" className="btn btn-outline sm" onClick={() => done(r.id)}>Marquer remboursé</button></td></tr>)}</tbody></table></div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function Contests() {
  const [term, setTerm] = useState(''); const { items, load } = useList<any>(`/admin/contests?q=${encodeURIComponent(term)}`); const [error, setError] = useState<string | null>(null);
  const toggle = async (c: any) => {
    try {
      if (c.payoutFrozenAt) await api(`/admin/contests/${c.id}/unfreeze`, { body: {} });
      else { const reason = window.prompt('Motif du gel des fonds :'); if (!reason) return; await api(`/admin/contests/${c.id}/freeze`, { body: { reason } }); }
      await load();
    } catch (e) { setError(msg(e)); }
  };
  return (
    <section>
      <input className="input" placeholder="Rechercher un concours (nom ou adresse)" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Recherche" />
      <div className="tablewrap"><table className="table"><thead><tr><th>Concours</th><th>Organisateur</th><th>Statut</th><th>Votes</th><th>Fonds</th><th /></tr></thead>
        <tbody>{items?.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><div className="muted small">{c.slug}</div></td><td>{c.ownerName ?? c.ownerEmail}</td><td>{c.status}</td><td>{c.totalVotes}</td>
          <td>{c.payoutFrozenAt ? <span className="error">Gelés<div className="small">{c.payoutFrozenReason}</div></span> : 'Normaux'}</td>
          <td><button type="button" className="btn btn-ghost sm" onClick={() => toggle(c)}>{c.payoutFrozenAt ? 'Dégeler' : 'Geler les fonds'}</button></td></tr>)}</tbody></table></div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function Fraud() {
  const { items, load } = useList<any>('/admin/fraud?status=open');
  const review = async (id: number, status: 'confirmed' | 'dismissed') => { await api(`/admin/fraud/${id}/review`, { body: { status } }); await load(); };
  return (
    <section>
      <div className="tablewrap"><table className="table"><thead><tr><th>Concours</th><th>Règle</th><th>Score</th><th>Détails</th><th /></tr></thead>
        <tbody>{items?.length === 0 && <tr><td colSpan={5} className="muted">Aucune alerte ouverte.</td></tr>}
          {items?.map((f) => <tr key={f.id}><td>{f.contestName}</td><td><code>{f.rule}</code></td><td>{f.score}</td><td className="small">{JSON.stringify(f.details)}</td>
            <td className="rowbtns"><button type="button" className="btn btn-outline sm" onClick={() => review(f.id, 'confirmed')}>Confirmer</button><button type="button" className="btn btn-ghost sm" onClick={() => review(f.id, 'dismissed')}>Écarter</button></td></tr>)}</tbody></table></div>
      <p className="muted small">Les alertes sont créées par les règles anti-fraude (à venir). L&apos;invalidation d&apos;un vote se fait via l&apos;API : <code>POST /admin/votes/:id/invalidate</code>.</p>
    </section>
  );
}

function Payouts() {
  const { items } = useList<any>('/admin/payouts');
  return (
    <section><div className="tablewrap"><table className="table"><thead><tr><th>Date</th><th>Créateur</th><th>Montant</th><th>Statut</th><th>Détail</th></tr></thead>
      <tbody>{items?.length === 0 && <tr><td colSpan={5} className="muted">Aucun retrait en cours ou échoué.</td></tr>}
        {items?.map((p) => <tr key={p.id}><td>{dateTime(p.requestedAt)}</td><td>{p.fullName ?? p.email}</td><td>{xaf(p.amountXaf)} (reçu {xaf(p.netXaf)})</td><td>{p.status}</td><td className="small">{p.failureReason}</td></tr>)}</tbody></table></div></section>
  );
}

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  overview: 'Surveille les opérations sensibles et les indicateurs de contrôle de la plateforme.',
  kyc: 'Examine les justificatifs et vérifie la concordance des informations avant validation.',
  refunds: 'Contrôle les paiements qui nécessitent une régularisation après remboursement chez l’agrégateur.',
  contests: 'Consulte les concours et contrôle le gel ou le dégel des fonds associés.',
  fraud: 'Analyse les alertes générées par les mécanismes de détection disponibles.',
  payouts: 'Suit les demandes de retrait et leurs statuts de traitement.',
};

export default function AdminPanel() {
  const me = useMe(); const [tab, setTab] = useState<Tab>('overview');
  if (me.role !== 'admin') return <div className="admin-denied"><div className="admin-denied-mark">!</div><p className="admin-kicker">ESPACE SÉCURISÉ</p><h2>Accès réservé</h2><p>Cette page est réservée aux administrateurs de VOTALLY.</p></div>;
  return (
    <div className="admin-page">
      <header className="admin-heading">
        <div>
          <p className="admin-kicker">VOTALLY / CONTRÔLE DE LA PLATEFORME</p>
          <h1>Centre d’administration</h1>
          <p className="admin-intro">Supervision des opérations, conformité et sécurité.</p>
        </div>
        <div className="admin-access"><span className="admin-access-dot" /> Session administrateur</div>
      </header>
      <nav className="admin-nav" aria-label="Modules d’administration" role="tablist">
        {TABS.map(([k, l], index) => <button key={k} id={`admin-tab-${k}`} role="tab" aria-selected={tab === k} aria-controls="admin-module" tabIndex={tab === k ? 0 : -1} className={tab === k ? 'active' : ''} type="button" onClick={() => setTab(k)}>
          <span className="admin-nav-index">0{index + 1}</span><span>{l}</span>{tab === k && <span className="admin-nav-arrow" aria-hidden="true">↗</span>}
        </button>)}
      </nav>
      <section className="admin-module" id="admin-module" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        <div className="admin-module-heading"><div><p className="admin-kicker">MODULE  /  {TABS.find(([key]) => key === tab)?.[1].toUpperCase()}</p><h2>{TABS.find(([key]) => key === tab)?.[1]}</h2><p>{TAB_DESCRIPTIONS[tab]}</p></div></div>
        <div className="admin-module-content">
          {tab === 'overview' && <Overview />}{tab === 'kyc' && <Kyc />}{tab === 'refunds' && <Refunds />}{tab === 'contests' && <Contests />}{tab === 'fraud' && <Fraud />}{tab === 'payouts' && <Payouts />}
        </div>
      </section>
      <footer className="admin-foot"><span>VOTALLY ADMIN</span><span>Accès réservé · Les actions sensibles sont journalisées par le serveur.</span></footer>
    </div>
  );
}
