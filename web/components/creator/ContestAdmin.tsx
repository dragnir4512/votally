'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { publicUrls, publishChecklist, ROLE_LABEL, STATUS_LABEL, VOTE_TYPE_LABEL, xaf,
  type Dashboard, type MyCandidate, type MyContest, type Role } from '../../lib/creator';
import CandidatesTab from './CandidatesTab';
import SettingsTab from './SettingsTab';
import TeamTab from './TeamTab';
import VotesTab from './VotesTab';

type Tab = 'overview' | 'candidates' | 'settings' | 'team' | 'votes';
const TABS: [Tab, string][] = [['overview', 'Aperçu'], ['candidates', 'Candidats'], ['votes', 'Votes'], ['settings', 'Paramètres'], ['team', 'Équipe']];

export function Overview({ contest, candidates, role, reload, goTo }: { contest: MyContest; candidates: MyCandidate[]; role: Role; reload: () => Promise<void>; goTo: (t: Tab) => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  const isOwner = role === 'owner';
  const urls = publicUrls(contest.slug);
  const checklist = publishChecklist(contest, candidates.filter((c) => c.isActive).length);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ dashboard: Dashboard }>(`/contests/${contest.id}/dashboard`).then((r) => alive && setDash(r.dashboard)).catch(() => undefined);
    load(); const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [contest.id, contest.status]);

  const act = async (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    try { await api(`/contests/${contest.id}/actions/${action}`, { method: 'POST', body: {} }); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Erreur'); } finally { setBusy(false); }
  };
  const copy = async (key: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(key); } catch { window.prompt('Copie ce lien', text); } };

  return (
    <section>
      {contest.status === 'draft' && (
        <div className="panel">
          <h3>Avant de publier</h3>
          <ul className="check">{checklist.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'todo'}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>
          <p className="small"><button type="button" className="btn btn-link" onClick={() => goTo('candidates')}>Gérer les candidats</button> · <button type="button" className="btn btn-link" onClick={() => goTo('settings')}>Compléter les paramètres</button></p>
          {isOwner && <button type="button" className="btn btn-primary" disabled={busy || !checklist.every((c) => c.ok)} onClick={() => act('activate')}>Publier le concours</button>}
        </div>
      )}

      {contest.status !== 'draft' && (
        <div className="panel">
          <h3>Adresse du concours</h3>
          {([['sub', urls.subdomain], ['path', urls.path]] as const).map(([k, u]) => (
            <div className="linkrow" key={k}><input className="input" readOnly value={u} onFocus={(e) => e.target.select()} aria-label="Adresse du concours" />
              <button type="button" className="btn btn-outline sm" onClick={() => copy(k, u)}>{copied === k ? 'Copié ✓' : 'Copier'}</button>
              <a className="btn btn-ghost sm" href={u} target="_blank" rel="noopener noreferrer">Ouvrir</a></div>))}
          <a className="btn btn-wa sm" target="_blank" rel="noopener noreferrer"
             href={`https://wa.me/?text=${encodeURIComponent(`Vote au concours « ${contest.name} » : ${urls.subdomain}`)}`}>Partager sur WhatsApp</a>
        </div>
      )}

      {isOwner && contest.status !== 'draft' && contest.status !== 'archived' && (
        <div className="panel">
          <h3>Gérer le concours</h3>
          <div className="actions">
            {contest.status === 'active' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('pause')}>Mettre en pause</button>}
            {contest.status === 'paused' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('resume')}>Reprendre</button>}
            {(contest.status === 'active' || contest.status === 'paused') &&
              <button type="button" className="btn btn-ghost danger" disabled={busy} onClick={() => act('close', 'Clôturer le concours ? Les votes seront bloqués définitivement.')}>Clôturer</button>}
            {contest.status === 'closed' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('archive', 'Archiver ce concours ?')}>Archiver</button>}
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="stats">
        <div className="stat"><b>{dash?.validVotes ?? '…'}</b><span>votes valides</span></div>
        <div className="stat"><b>{dash?.paidVotes ?? '…'}</b><span>votes payants</span></div>
        <div className="stat"><b>{dash?.freeVotes ?? '…'}</b><span>votes gratuits</span></div>
        <div className="stat"><b>{dash?.pendingOrders ?? '…'}</b><span>paiements en attente</span></div>
      </div>
      {!!dash?.openFraudFlags && <p className="notice small">⚠ {dash.openFraudFlags} alerte(s) de fraude à examiner.</p>}

      {isOwner && dash && contest.voteType !== 'free' && (
        <div className="panel">
          <h3>Finances</h3>
          <dl className="totals">
            <div><dt>Votes payés (hors frais)</dt><dd>{xaf(dash.grossXaf)}</dd></div>
            <div><dt>Commission VOTALLY (8 %)</dt><dd>− {xaf(dash.commissionXaf)}</dd></div>
            <div className="grand"><dt>Solde du concours</dt><dd>{xaf(dash.balanceXaf)}</dd></div>
          </dl>
          <p className="muted small">Les frais de transaction sont payés par les votants en plus du prix des votes. Les retraits (Mobile Money) sont possibles après la clôture du concours et un délai de sécurité de 72 h, une fois ton identité vérifiée.</p>
          <Link href="/espace/compte" className="btn btn-outline sm">Vérifier mon identité / retirer mon argent</Link>
        </div>
      )}
    </section>
  );
}

export default function ContestAdmin({ id }: { id: string }) {
  const [contest, setContest] = useState<MyContest | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [cands, setCands] = useState<MyCandidate[]>([]);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  const reload = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([api<{ contest: MyContest; myRole: Role }>(`/contests/${id}`), api<{ candidates: MyCandidate[] }>(`/contests/${id}/candidates`)]);
      setContest(c.contest); setRole(c.myRole); setCands(k.candidates);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setMissing(true); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  if (missing) return <div className="panel center"><h2>Concours introuvable</h2><Link href="/espace" className="btn btn-primary">Retour à mes concours</Link></div>;
  if (!contest || !role) return <p className="muted center pad">Chargement…</p>;
  const canEdit = role === 'owner' || role === 'manager';

  return (
    <>
      <p className="small"><Link href="/espace">← Mes concours</Link></p>
      <div className="title-row">
        <h1>{contest.name}</h1>
        <span className={`badge st-${contest.status}`}>{STATUS_LABEL[contest.status]}</span>
      </div>
      <p className="muted small">{VOTE_TYPE_LABEL[contest.voteType]}{contest.voteType !== 'free' && ` · ${xaf(contest.votePriceXaf)} / vote`} · Ton rôle : {ROLE_LABEL[role]}</p>
      <div className="tabs scroll" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} type="button" onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'overview' && <Overview contest={contest} candidates={cands} role={role} reload={reload} goTo={setTab} />}
      {tab === 'candidates' && <CandidatesTab contest={contest} candidates={cands} canEdit={canEdit} reload={reload} />}
      {tab === 'votes' && <VotesTab contestId={contest.id} canSeeOrders={canEdit} />}
      {tab === 'settings' && <SettingsTab contest={contest} canEdit={canEdit} isOwner={role === 'owner'} reload={reload} />}
      {tab === 'team' && <TeamTab contestId={contest.id} isOwner={role === 'owner'} />}
    </>
  );
}
