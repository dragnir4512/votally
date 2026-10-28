'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/client';
import ContestForm from '../../../components/creator/ContestForm';

export default function NouveauConcours() {
  const router = useRouter();
  return (
    <>
      <p className="small"><Link href="/espace">← Mes concours</Link></p>
      <h1>Nouveau concours</h1>
      <p className="muted">Le concours est créé en brouillon : tu ajoutes ensuite les candidats, puis tu le publies.</p>
      <div className="panel">
        <ContestForm locked={false} submitLabel="Créer le brouillon"
          onSubmit={async (body) => { const r = await api<{ contest: { id: string } }>('/contests', { body }); router.push(`/espace/${r.contest.id}`); }} />
      </div>
    </>
  );
}
