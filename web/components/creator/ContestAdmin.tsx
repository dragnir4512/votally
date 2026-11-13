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
const TABS: { key: Tab; label: string; hint: string; icon: string }[] = [
  { key: 'overview', label: 'Vue d’ensemble', hint: 'Activité et état du concours', icon: '▦' },
  { key: 'candidates', label: 'Candidats', hint: 'Profils et participation', icon: '◎' },
  { key: 'votes', label: 'Votes & résultats', hint: 'Classement et commandes', icon: '↗' },
  { key: 'settings', label: 'Configuration', hint: 'Informations et règles', icon: '⚙' },
  { key: 'team', label: 'Équipe', hint: 'Accès et collaborateurs', icon: '♧' },
];

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
    <section className="contest-overview">
      {contest.status === 'draft' && (
        <div className="panel contest-panel contest-publish-panel">
          <div className="contest-panel-heading"><div><span className="contest-kicker">PRÉPARATION</span><h3>Prêt à être publié ?</h3><p>Vérifie ces éléments avant d’ouvrir ton concours au public.</p></div><span className="contest-panel-symbol">✓</span></div>
          <ul className="check contest-checklist">{checklist.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'todo'}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>
          <div className="contest-inline-actions">
            <button type="button" className="btn btn-link" onClick={() => goTo('candidates')}>Gérer les candidats</button>
            <button type="button" className="btn btn-link" onClick={() => goTo('settings')}>Compléter les paramètres</button>
            {isOwner && <button type="button" className="btn btn-primary" disabled={busy || !checklist.every((c) => c.ok)} onClick={() => act('activate')}>{busy ? 'Publication…' : 'Publier le concours'}</button>}
          </div>
        </div>
      )}

      {contest.status !== 'draft' && (
        <div className="panel contest-panel">
          <div className="contest-panel-heading"><div><span className="contest-kicker">VISIBILITÉ</span><h3>Adresse publique</h3><p>Partage ces liens pour permettre au public de participer.</p></div><span className="contest-panel-symbol">↗</span></div>
          {([['sub', 'Adresse personnalisée', urls.subdomain], ['path', 'Lien direct', urls.path]] as const).map(([k, label, u]) => (
            <div className="linkrow contest-linkrow" key={k}><label>{label}</label><input className="input" readOnly value={u} onFocus={(e) => e.target.select()} aria-label={label} />
              <button type="button" className="btn btn-outline sm" onClick={() => copy(k, u)}>{copied === k ? 'Copié ✓' : 'Copier'}</button>
              <a className="btn btn-ghost sm" href={u} target="_blank" rel="noopener noreferrer">Ouvrir</a></div>))}
          <a className="btn btn-wa sm contest-whatsapp" target="_blank" rel="noopener noreferrer"
             href={`https://wa.me/?text=${encodeURIComponent(`Vote au concours « ${contest.name} » : ${urls.subdomain}`)}`}>Partager sur WhatsApp</a>
        </div>
      )}

      {isOwner && contest.status !== 'draft' && contest.status !== 'archived' && (
        <div className="panel contest-panel">
          <div className="contest-panel-heading"><div><span className="contest-kicker">ACTIONS</span><h3>Cycle de vie du concours</h3><p>Les actions disponibles dépendent de son statut actuel.</p></div></div>
          <div className="actions contest-inline-actions">
            {contest.status === 'active' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('pause')}>Mettre en pause</button>}
            {contest.status === 'paused' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('resume')}>Reprendre</button>}
            {(contest.status === 'active' || contest.status === 'paused') &&
              <button type="button" className="btn btn-ghost danger" disabled={busy} onClick={() => act('close', 'Clôturer le concours ? Les votes seront bloqués définitivement.')}>Clôturer</button>}
            {contest.status === 'closed' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('archive', 'Archiver ce concours ?')}>Archiver</button>}
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="contest-section-title"><div><span className="contest-kicker">PERFORMANCE</span><h3>Indicateurs du concours</h3></div><span className="contest-live-note"><i /> Actualisation automatique</span></div>
      <div className="stats contest-stats">
        <div className="stat contest-stat"><span>Votes valides</span><b>{dash?.validVotes ?? '…'}</b><small>Total comptabilisé</small></div>
        <div className="stat contest-stat"><span>Votes payants</span><b>{dash?.paidVotes ?? '…'}</b><small>Contributions payées</small></div>
        <div className="stat contest-stat"><span>Votes gratuits</span><b>{dash?.freeVotes ?? '…'}</b><small>Participations gratuites</small></div>
        <div className="stat contest-stat"><span>Paiements en attente</span><b>{dash?.pendingOrders ?? '…'}</b><small>Commandes à confirmer</small></div>
      </div>
      {!!dash?.openFraudFlags && <p className="notice small">⚠ {dash.openFraudFlags} alerte(s) de fraude à examiner.</p>}

      {isOwner && dash && contest.voteType !== 'free' && (
        <div className="panel contest-panel contest-finance">
          <div className="contest-panel-heading"><div><span className="contest-kicker">SUIVI FINANCIER</span><h3>Finances du concours</h3><p>Vue synthétique des montants générés par les votes.</p></div><span className="contest-panel-symbol">₣</span></div>
          <dl className="totals contest-finance-totals">
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
  if (!contest || !role) return <div className="contest-loading"><span className="organizer-spinner" /><p>Chargement de ton espace concours…</p></div>;
  const canEdit = role === 'owner' || role === 'manager';
  const activeCount = cands.filter((c) => c.isActive).length;
  const currentTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  return (
    <div className="contest-admin">
      <Link href="/espace" className="contest-back">← <span>Retour à mes concours</span></Link>
      <header className="contest-hero">
        <div className="contest-hero-copy">
          <span className="contest-kicker">ESPACE ORGANISATEUR / CONCOURS</span>
          <div className="contest-title-line"><h1>{contest.name}</h1><span className={`badge st-${contest.status}`}>{STATUS_LABEL[contest.status]}</span></div>
          <p>{contest.description || 'Pilote ton concours, suis les participations et configure son fonctionnement depuis cet espace.'}</p>
          <div className="contest-meta"><span>{VOTE_TYPE_LABEL[contest.voteType]}{contest.voteType !== 'free' && ` · ${xaf(contest.votePriceXaf)} / vote`}</span><span>Ton rôle : {ROLE_LABEL[role]}</span><span>{contest.visibility === 'public' ? 'Concours public' : 'Concours privé'}</span></div>
        </div>
        <div className="contest-hero-mark" aria-hidden="true">V.</div>
      </header>

      <div className="contest-quick-stats">
        <div><span>Candidats actifs</span><strong>{activeCount}</strong></div>
        <div><span>Total candidats</span><strong>{cands.length}</strong></div>
        <div><span>Mode de vote</span><strong>{VOTE_TYPE_LABEL[contest.voteType]}</strong></div>
        <div><span>Fin du concours</span><strong>{contest.endsAt ? new Date(contest.endsAt).toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' }) : 'Non définie'}</strong></div>
      </div>

      <div className="contest-workspace">
        <nav className="contest-sidebar" aria-label="Navigation du concours">
          <span className="contest-sidebar-label">GESTION DU CONCOURS</span>
          {TABS.filter((item) => item.key !== 'team' || role !== 'viewer').map((item) => <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)} aria-current={tab === item.key ? 'page' : undefined}>
            <span className="contest-tab-icon">{item.icon}</span><span className="contest-tab-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><span className="contest-tab-arrow">›</span>
          </button>)}
          <div className="contest-sidebar-foot"><span className="contest-sidebar-dot" /> Espace sécurisé</div>
        </nav>
        <main className="contest-content">
          <div className="contest-content-heading"><div><span className="contest-kicker">GESTION</span><h2>{currentTab.label}</h2><p>{currentTab.hint}</p></div><span className="contest-role-chip">{ROLE_LABEL[role]}</span></div>
          {tab === 'overview' && <Overview contest={contest} candidates={cands} role={role} reload={reload} goTo={setTab} />}
          {tab === 'candidates' && <CandidatesTab contest={contest} candidates={cands} canEdit={canEdit} reload={reload} />}
          {tab === 'votes' && <VotesTab contestId={contest.id} canSeeOrders={canEdit} isOwner={role === 'owner'} />}
          {tab === 'settings' && <SettingsTab contest={contest} canEdit={canEdit} isOwner={role === 'owner'} reload={reload} />}
          {tab === 'team' && role !== 'viewer' && <TeamTab contestId={contest.id} isOwner={role === 'owner'} />}
        </main>
      </div>
    </div>
  );
}
