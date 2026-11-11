'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/client';
import { STATUS_LABEL, VOTE_TYPE_LABEL, ROLE_LABEL, xaf, type MyContest } from '../../lib/creator';

export default function MesConcours() {
  const [items, setItems] = useState<MyContest[] | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ contests: MyContest[] }>('/contests')
      .then((r) => { if (alive) setItems(r.contests); })
      .catch(() => { if (alive) { setItems([]); setHasError(true); } });
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    const contests = items ?? [];
    return {
      total: contests.length,
      active: contests.filter((c) => c.status === 'active').length,
      drafts: contests.filter((c) => c.status === 'draft').length,
      votes: contests.reduce((sum, c) => sum + (c.totalVotes ?? 0), 0),
    };
  }, [items]);

  return (
    <div className="organizer-dashboard">
      <section className="organizer-welcome">
        <div>
          <p className="organizer-eyebrow"><span /> ESPACE ORGANISATEUR</p>
          <h1>Pilotez vos concours.</h1>
          <p>Retrouvez vos compétitions, suivez leur activité et gérez leur évolution depuis un seul espace.</p>
        </div>
        <Link className="organizer-primary" href="/espace/nouveau"> <span aria-hidden>＋</span> Créer un concours</Link>
      </section>

      <section className="organizer-stats" aria-label="Vue d'ensemble">
        <article className="organizer-stat"><span className="organizer-stat-icon red">▤</span><div><small>Mes concours</small><strong>{items ? stats.total : '—'}</strong><span>Tous statuts confondus</span></div></article>
        <article className="organizer-stat"><span className="organizer-stat-icon green">↗</span><div><small>En cours</small><strong>{items ? stats.active : '—'}</strong><span>Concours actifs</span></div></article>
        <article className="organizer-stat"><span className="organizer-stat-icon amber">◷</span><div><small>Brouillons</small><strong>{items ? stats.drafts : '—'}</strong><span>À finaliser</span></div></article>
        <article className="organizer-stat"><span className="organizer-stat-icon dark">✓</span><div><small>Votes enregistrés</small><strong>{items ? stats.votes.toLocaleString('fr-FR') : '—'}</strong><span>Total de vos concours</span></div></article>
      </section>

      <section className="organizer-list-section">
        <div className="organizer-section-heading">
          <div><p className="organizer-eyebrow">VOTRE ACTIVITÉ</p><h2>Vos concours</h2><p>Accédez à la gestion de chaque concours.</p></div>
          {items && items.length > 0 && <Link href="/espace/nouveau" className="organizer-outline">Nouveau concours <span aria-hidden>↗</span></Link>}
        </div>

        {!items && <div className="organizer-loading"><span className="organizer-spinner" />Chargement de vos concours…</div>}

        {hasError && <div className="organizer-empty"><span className="organizer-empty-icon">!</span><h3>Impossible de charger vos concours</h3><p>Vérifiez votre connexion puis rechargez la page.</p><button type="button" className="organizer-outline" onClick={() => window.location.reload()}>Réessayer</button></div>}

        {items && !hasError && items.length === 0 && (
          <div className="organizer-empty"><span className="organizer-empty-icon">＋</span><h3>Votre premier concours commence ici</h3><p>Créez un concours, ajoutez vos candidats et configurez les règles avant sa publication.</p><Link className="organizer-primary" href="/espace/nouveau">Créer mon premier concours <span aria-hidden>↗</span></Link></div>
        )}

        {items && !hasError && items.length > 0 && (
          <div className="organizer-contest-grid">
            {items.map((c) => (
              <Link key={c.id} href={`/espace/${c.id}`} className="organizer-contest-card">
                <div className="organizer-contest-top"><span className={`organizer-status status-${c.status}`}><i />{STATUS_LABEL[c.status]}</span><span className="organizer-card-arrow" aria-hidden>↗</span></div>
                <h3>{c.name}</h3>
                <p className="organizer-contest-description">{c.description || 'Aucune description renseignée pour le moment.'}</p>
                <div className="organizer-contest-metrics"><span><strong>{(c.candidatesCount ?? 0).toLocaleString('fr-FR')}</strong> candidats</span><span><strong>{(c.totalVotes ?? 0).toLocaleString('fr-FR')}</strong> votes</span></div>
                <div className="organizer-contest-bottom"><span>{VOTE_TYPE_LABEL[c.voteType]} · {c.myRole ? ROLE_LABEL[c.myRole] : 'Accès'}</span><span>Gérer le concours <b>→</b></span></div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
