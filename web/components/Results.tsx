'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/client';
import type { T } from '../lib/i18n';

interface Row { candidateId: string; number: number; name: string; validVotes: number; rank: number; percent: number }

export default function Results({ slug, realtime, t, err }: { slug: string; realtime: boolean; t: T['t']; err: T['err'] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api<{ results: Row[]; totalVotes: number }>(`/public/contests/${slug}/results`);
        if (alive) { setRows(r.results); setTotal(r.totalVotes); setHidden(false); }
      } catch (e) {
        if (alive && e instanceof ApiError && e.code === 'results_hidden') setHidden(true);
        else if (alive) setRows((x) => x ?? []);
      }
    };
    load();
    const id = realtime ? setInterval(load, 15_000) : undefined;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [slug, realtime]);

  if (hidden) return <p className="muted center pad">{t('resultsHidden')}</p>;
  if (!rows) return <p className="muted center pad">{t('loading')}</p>;
  if (!total) return <p className="muted center pad">{t('noResults')}</p>;
  return (
    <ol className="results" aria-live="polite">
      {rows.map((r) => (
        <li key={r.candidateId}>
          <div className="res-head"><span className="rank">{r.rank}</span><span className="res-name">{r.name}</span>
            <span className="res-val">{r.validVotes.toLocaleString()} · {r.percent}%</span></div>
          <div className="bar" role="presentation"><span style={{ width: `${Math.max(r.percent, 1)}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}
