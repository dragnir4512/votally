'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/client';
import { parseBulk } from '../../../lib/creator';
import ContestForm from '../../../components/creator/ContestForm';

type Stage = 'setup' | 'candidates';

export default function NouveauConcours() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('setup');
  const [contestId, setContestId] = useState<string | null>(null);
  const [candidateText, setCandidateText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = parseBulk(candidateText);

  const addCandidates = async () => {
    if (!contestId || busy) return;
    if (candidates.length < 2) {
      setError('Ajoute au moins deux candidats pour pouvoir publier le concours.');
      return;
    }
    setBusy(true); setError(null);
    try {
      // Évite de dupliquer l'import si le serveur a accepté la requête mais que la réponse réseau a été perdue.
      const existing = await api<{ candidates: { id: string }[] }>(`/contests/${contestId}/candidates`);
      if (existing.candidates.length === 0) {
        await api(`/contests/${contestId}/candidates`, { body: candidates });
      }
      router.push(`/espace/${contestId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ajouter les candidats. Le brouillon est conservé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create-flow">
      <p className="small"><Link href="/espace">← Mes concours</Link></p>
      <header className="create-flow-heading">
        <span className="create-flow-kicker">ESPACE ORGANISATEUR</span>
        <h1>Nouveau concours</h1>
        <p>Configure ton concours, ajoute tes candidats et prépare sa publication.</p>
      </header>

      <nav className="create-stepper" aria-label="Étapes de création">
        <div className={stage === 'setup' ? 'active' : 'done'}><span>1</span><div><strong>Configuration</strong><small>Identité, votes et règles</small></div></div>
        <i aria-hidden="true" />
        <div className={stage === 'candidates' ? 'active' : ''}><span>2</span><div><strong>Candidats</strong><small>Import et préparation</small></div></div>
      </nav>

      {stage === 'setup' && (
        <section className="create-flow-card">
          <div className="create-flow-card-heading">
            <span className="create-flow-kicker">ÉTAPE 1 / 2</span>
            <h2>Les informations du concours</h2>
            <p>Le concours sera d’abord enregistré en brouillon. Tu pourras encore le modifier avant sa publication.</p>
          </div>
          <ContestForm locked={false} submitLabel="Enregistrer et continuer"
            onSubmit={async (body) => {
              const r = await api<{ contest: { id: string } }>('/contests', { body });
              setContestId(r.contest.id);
              setStage('candidates');
            }} />
        </section>
      )}

      {stage === 'candidates' && (
        <section className="create-flow-card">
          <div className="create-flow-card-heading">
            <span className="create-flow-kicker">ÉTAPE 2 / 2</span>
            <h2>Ajoute les candidats</h2>
            <p>Tu peux les saisir maintenant ou passer cette étape et les ajouter plus tard depuis l’onglet « Candidats ».</p>
          </div>
          <label className="field create-candidate-field">
            <span>Liste des candidats</span>
            <textarea className="input" rows={10} value={candidateText} onChange={(e) => { setCandidateText(e.target.value); setError(null); }}
              placeholder={'Exemple :\nAlice ; Présentation de la candidate\nBella ; Présentation de la candidate\nChantal ; Présentation de la candidate'} />
            <small className="muted">Une personne par ligne. Format : Nom ; description facultative. Maximum 500 candidats.</small>
          </label>
          <div className="create-candidate-preview">
            <strong>{candidates.length} candidat(s) détecté(s)</strong>
            <span>{candidates.length >= 2 ? 'Minimum requis pour publier atteint' : 'Deux candidats actifs minimum sont nécessaires pour publier'}</span>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions create-flow-actions">
            <button type="button" className="btn btn-primary" disabled={busy || candidates.length < 2} onClick={addCandidates}>
              {busy ? 'Ajout en cours…' : 'Ajouter les candidats et terminer'}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy || !contestId} onClick={() => contestId && router.push(`/espace/${contestId}`)}>
              Ajouter plus tard
            </button>
          </div>
          <p className="muted small create-flow-footnote">Ton brouillon est déjà sauvegardé. Les candidats pourront aussi être ajoutés individuellement et recevoir leurs photos depuis l’espace de gestion.</p>
        </section>
      )}
    </div>
  );
}
