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

  const status = kyc?.status === 'approved' ? 'Identité vérifiée' : kyc?.status === 'pending' ? 'Vérification en cours' : kyc?.status === 'rejected' ? 'Action requise' : 'À configurer';
  const statusClass = kyc?.status === 'approved' ? 'account-status-approved' : kyc?.status === 'pending' ? 'account-status-pending' : kyc?.status === 'rejected' ? 'account-status-rejected' : 'account-status-neutral';

  return (
    <div className="account-page">
      <p className="account-breadcrumb"><Link href="/espace">← Retour au tableau de bord</Link></p>
      <header className="account-heading">
        <div>
          <p className="account-eyebrow">ESPACE ORGANISATEUR / PARAMÈTRES</p>
          <h1>Mon compte</h1>
          <p>Gérez les informations de vérification et le compte Mobile Money utilisé pour vos retraits.</p>
        </div>
        {kyc !== undefined && <span className={`account-status ${statusClass}`}><i />{status}</span>}
      </header>

      {kyc === undefined && <div className="account-loading"><span className="organizer-spinner" />Chargement des informations du compte…</div>}

      {kyc?.status === 'pending' && (
        <section className="account-status-panel pending">
          <div className="account-status-icon">◷</div>
          <div><span className="account-section-kicker">DOSSIER TRANSMIS</span><h2>Vérification en cours</h2>
            <p>Ton dossier envoyé le {dateTime(kyc.submittedAt)} est en cours d’examen. Le délai annoncé est de 48 heures ouvrées. Les retraits seront disponibles après validation.</p></div>
        </section>
      )}

      {kyc?.status === 'rejected' && (
        <section className="account-status-panel rejected">
          <div className="account-status-icon">!</div>
          <div><span className="account-section-kicker">ACTION NÉCESSAIRE</span><h2>Dossier à corriger</h2>
            <p>Le dossier a été refusé pour le motif suivant : <strong>{kyc.rejectionReason}</strong></p>
            <p>Corrige les informations ou les documents concernés, puis soumets un nouveau dossier ci-dessous.</p></div>
        </section>
      )}

      {(kyc === null || kyc?.status === 'rejected') && (
        <section className="account-section">
          <div className="account-section-heading"><div><span className="account-section-kicker">01 / CONFORMITÉ</span><h2>Vérification de l’identité</h2>
            <p>Cette vérification est nécessaire avant le premier retrait.</p></div></div>
          <KycForm onSubmitted={load} />
        </section>
      )}

      {kyc?.status === 'approved' && (
        <>
          <section className="account-section">
            <div className="account-section-heading"><div><span className="account-section-kicker">01 / CONFORMITÉ</span><h2>Identité vérifiée</h2>
              <p>Les informations de conformité enregistrées pour ton compte.</p></div><span className="account-verified-label">✓ Vérifié</span></div>
            <div className="account-identity-card">
              <div className="account-identity-mark">✓</div>
              <div><span>Nom légal vérifié</span><strong>{kyc.legalName}</strong></div>
              <div><span>Compte de réception</span><strong>{kyc.payoutMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Orange Money'}</strong></div>
              <div><span>Numéro enregistré</span><strong>{kyc.payoutPhoneMasked}</strong></div>
            </div>
          </section>
          <section className="account-section">
            <div className="account-section-heading"><div><span className="account-section-kicker">02 / FINANCES</span><h2>Solde et retraits</h2>
              <p>Consulte ton solde disponible, demande un retrait et suis son traitement.</p></div></div>
            <PayoutPanel payoutPhone={kyc.payoutPhoneMasked} />
          </section>
        </>
      )}

      <p className="account-security-note">Les documents d’identité sont conservés dans un espace privé et consultés uniquement pour les contrôles nécessaires. Les informations de profil personnel ne sont pas modifiables depuis cette page dans la version actuelle.</p>
    </div>
  );
}
