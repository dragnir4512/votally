'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';
import { STATUS_LABEL, VOTE_TYPE_LABEL, ROLE_LABEL, type MyContest } from '../../lib/creator';

export default function MesConcours() {
  const [items, setItems] = useState<MyContest[] | null>(null);
  useEffect(() => { api<{ contests: MyContest[] }>('/contests').then((r) => setItems(r.contests)).catch(() => setItems([])); }, []);
  return (
    <>
      <div className="title-row"><h1>Mes concours</h1><Link className="btn btn-primary" href="/espace/nouveau">+ Nouveau concours</Link></div>
      {!items && <p className="muted center pad">Chargement…</p>}
      {items && items.length === 0 && (
        <div className="panel center"><h2>Crée ton premier concours</h2><p className="muted">Quelques minutes suffisent : nom, candidats, règlement, et c&apos;est en ligne.</p>
          <Link className="btn btn-primary" href="/espace/nouveau">Créer un concours</Link></div>
      )}
      <div className="cards">
        {items?.map((c) => (
          <Link key={c.id} href={`/espace/${c.id}`} className="ccard">
            <div className="title-row"><h3>{c.name}</h3><span className={`badge st-${c.status}`}>{STATUS_LABEL[c.status]}</span></div>
            <p className="muted small">{VOTE_TYPE_LABEL[c.voteType]} · {c.candidatesCount ?? 0} candidat(s) · {c.totalVotes ?? 0} vote(s)</p>
            <p className="muted small">{c.myRole ? ROLE_LABEL[c.myRole] : ''}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
