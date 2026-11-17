'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/client';
import { initials, mediaUrl } from '../lib/format';
import type { T } from '../lib/i18n';

interface Row { candidateId: string; number: number; name: string; imageKey: string | null; validVotes: number; rank: number; percent: number }

export default function Results({ slug, realtime, t, err }: { slug: string; realtime: boolean; t: T['t']; err: T['err'] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [contestStatus, setContestStatus] = useState<'active' | 'paused' | 'closed'>('active');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api<{ results: Row[]; totalVotes: number; status: 'active' | 'paused' | 'closed' }>(`/public/contests/${slug}/results`);
        if (alive) {
          setRows(r.results); setTotal(r.totalVotes); setContestStatus(r.status);
          setHidden(false); setLoadError(false); setUpdatedAt(Date.now());
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.code === 'results_hidden') setHidden(true);
        else setLoadError(true);
      }
    };
    load();
    // Poll even when results are hidden until close: on_close must become visible
    // without requiring the visitor to reload the page. The API remains the authority.
    const id = window.setInterval(load, 15_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [slug, realtime]);

  if (hidden) return <p className="muted center pad">{t('resultsHidden')}</p>;
  if (!rows) return <p className="muted center pad">{loadError ? 'Impossible de charger le classement. Réessayez dans quelques instants.' : t('loading')}</p>;
  if (!total || !rows.length) return <div className="results-empty"><span className="results-empty-mark">—</span><strong>{t('noResults')}</strong><p>Le classement apparaîtra dès l'enregistrement des premiers votes validés.</p></div>;

  const podium = rows.filter((r) => r.rank <= 3).sort((a, b) => a.rank - b.rank);
  const rest = rows.filter((r) => r.rank > 3);
  const refreshLabel = updatedAt ? new Date(updatedAt).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' }) : null;
  const renderPhoto = (row: Row, className: string) => {
    const src = mediaUrl(row.imageKey);
    return src ? <img className={className} src={src} alt={row.name} loading="lazy" width={96} height={96} />
      : <span className={`${className} results-avatar-fallback`} aria-label={row.name}>{initials(row.name)}</span>;
  };

  return (
    <div className="results-showcase" aria-live="polite">
      <div className="results-overview">
        <div><span className="results-kicker">PERFORMANCES</span><strong>{total.toLocaleString('fr-FR')}</strong><span>votes validés</span></div>
        <span className={`results-state ${contestStatus === 'closed' ? 'is-final' : 'is-live'}`}><i />{contestStatus === 'closed' ? 'Résultats définitifs' : 'Classement provisoire'}</span>
      </div>
      <div className="results-podium" aria-label="Podium des trois premiers candidats">
        {([1, 2, 3] as const).map((rank) => {
          const row = podium.find((candidate) => candidate.rank === rank);
          return row ? (
            <article className={`results-podium-card rank-${rank}`} key={row.candidateId}>
              <span className="results-podium-rank">{String(rank).padStart(2, '0')}</span>
              <div className="results-podium-photo">{renderPhoto(row, 'results-podium-image')}</div>
              <span className="results-podium-label">{rank === 1 ? 'PREMIÈRE PLACE' : rank === 2 ? 'DEUXIÈME PLACE' : 'TROISIÈME PLACE'}</span>
              <strong className="results-podium-name">{row.name}</strong>
              <span className="results-podium-number">Candidat N° {row.number}</span>
              <strong className="results-podium-votes">{row.validVotes.toLocaleString('fr-FR')} <small>votes</small></strong>
              <div className="results-podium-bar"><span style={{ height: `${Math.max(5, row.percent)}%` }} /></div>
            </article>
          ) : <div className="results-podium-card is-empty" key={rank}><span className="results-podium-rank">{String(rank).padStart(2, '0')}</span><span>En attente des résultats</span></div>;
        })}
      </div>
      {rest.length > 0 && <section className="results-table-section">
        <div className="results-table-heading"><div><span className="results-kicker">CLASSEMENT GÉNÉRAL</span><h4>Les autres candidats</h4></div><span>{rows.length} candidats</span></div>
        <ol className="results-table">
          {rest.map((row) => <li className="results-row" key={row.candidateId}>
            <span className="results-row-rank">{row.rank}</span>{renderPhoto(row, 'results-row-image')}
            <div className="results-row-person"><strong>{row.name}</strong><span>Candidat N° {row.number}</span><div className="results-row-track"><i style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div></div>
            <div className="results-row-score"><strong>{row.validVotes.toLocaleString('fr-FR')}</strong><span>{row.percent.toLocaleString('fr-FR')} %</span></div>
          </li>)}
        </ol>
      </section>}
      {refreshLabel && <p className="results-updated">Dernière actualisation : {refreshLabel} · Fuseau horaire de Yaoundé</p>}
    </div>
  );
}
