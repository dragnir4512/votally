'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/client';
import { dateTime, xaf } from '../../lib/creator';

interface Row { candidateId: string; number: number; name: string; validVotes: number; paidVotes: number; freeVotes: number; rank: number; isActive: boolean }
interface Order { reference: string; kind: 'free' | 'paid'; status: string; votesCount: number; totalXaf: number; voterPhoneMasked: string | null; createdAt: string }
const STATUS: Record<string, string> = { pending: 'En attente', confirmed: 'Confirmé', failed: 'Échoué', expired: 'Expiré', cancelled: 'Annulé', refunded: 'Remboursé' };

export default function VotesTab({ contestId, canSeeOrders }: { contestId: string; canSeeOrders: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null); const [orders, setOrders] = useState<Order[]>([]);
  const load = useCallback(async () => {
    const r = await api<{ results: Row[] }>(`/contests/${contestId}/results`).catch(() => null);
    if (r) setRows(r.results);
    if (canSeeOrders) { const o = await api<{ orders: Order[] }>(`/contests/${contestId}/orders?limit=50`).catch(() => null); if (o) setOrders(o.orders); }
  }, [contestId, canSeeOrders]);
  useEffect(() => { load(); const id = setInterval(load, 20_000); return () => clearInterval(id); }, [load]);
  const total = rows?.reduce((s, r) => s + r.validVotes, 0) ?? 0;

  return (
    <section>
      <div className="head-row"><h3>Classement</h3>
        {canSeeOrders && <a className="btn btn-ghost sm" href={`/api/contests/${contestId}/results.csv`}>Exporter en CSV</a>}</div>
      {!rows ? <p className="muted">Chargement…</p> : (
        <div className="tablewrap"><table className="table">
          <thead><tr><th>Rang</th><th>N°</th><th>Candidat</th><th className="num">Votes</th><th className="num">Payants</th><th className="num">Gratuits</th><th className="num">%</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.candidateId} className={r.isActive ? '' : 'off'}><td>{r.rank}</td><td>{r.number}</td><td>{r.name}</td>
              <td className="num"><strong>{r.validVotes}</strong></td><td className="num">{r.paidVotes}</td><td className="num">{r.freeVotes}</td>
              <td className="num">{total ? Math.round((r.validVotes / total) * 1000) / 10 : 0}</td></tr>))}</tbody></table></div>
      )}
      {canSeeOrders && (
        <>
          <div className="head-row"><h3>Dernières commandes</h3><button type="button" className="btn btn-ghost sm" onClick={load}>Actualiser</button></div>
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Date</th><th>Référence</th><th>Type</th><th>Votes</th><th>Montant</th><th>Statut</th><th>Téléphone</th></tr></thead>
            <tbody>{orders.length === 0 && <tr><td colSpan={7} className="muted">Aucune commande.</td></tr>}
              {orders.map((o) => (<tr key={o.reference}><td>{dateTime(o.createdAt)}</td><td><code>{o.reference}</code></td><td>{o.kind === 'paid' ? 'Payant' : 'Gratuit'}</td>
                <td>{o.votesCount}</td><td>{o.kind === 'paid' ? xaf(o.totalXaf) : '—'}</td><td>{STATUS[o.status] ?? o.status}</td><td>{o.voterPhoneMasked ?? '—'}</td></tr>))}</tbody></table></div>
        </>
      )}
    </section>
  );
}
