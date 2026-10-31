'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import KycForm from '../../../components/creator/KycForm';
import PayoutPanel from '../../../components/creator/PayoutPanel';
import { api } from '../../../lib/client';
import { dateTime, type Kyc } from '../../../lib/creator';

export default function MonCompte() {
  const [kyc, setKyc] = useState<Kyc | null | undefined>(undefined);
  const load = useCallback(() => api<{ kyc: Kyc | null }>('/me/kyc').then((r) => setKyc(r.kyc)).catch(() => setKyc(null)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <p className="small"><Link href="/espace">← Mes concours</Link></p>
      <h1>Mon compte</h1>
      {kyc === undefined && <p className="muted center pad">Chargement…</p>}
      {kyc?.status === 'pending' && (
        <div className="panel"><h3>Dossier en cours d&apos;examen</h3>
          <p>Ton dossier du {dateTime(kyc.submittedAt)} est en cours de vérification (48 h ouvrées). Tu pourras retirer ton argent dès sa validation.</p></div>
      )}
      {kyc?.status === 'rejected' && (
        <div className="panel danger-zone"><h3>Dossier refusé</h3><p>Motif : <strong>{kyc.rejectionReason}</strong></p><p className="muted small">Corrige et renvoie ton dossier ci-dessous.</p></div>
      )}
      {(kyc === null || kyc?.status === 'rejected') && <KycForm onSubmitted={load} />}
      {kyc?.status === 'approved' && (
        <>
          <p className="notice small">✓ Identité vérifiée ({kyc.legalName}). Compte {kyc.payoutMethod === 'mtn_momo' ? 'MTN MoMo' : 'Orange Money'} : {kyc.payoutPhoneMasked}</p>
          <PayoutPanel payoutPhone={kyc.payoutPhoneMasked} />
        </>
      )}
    </>
  );
}
