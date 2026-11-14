'use client';
import { useState } from 'react';
import { ApiError } from '../../lib/client';
import { buildPayload, emptyForm, type FormValues } from '../../lib/creator';

function L({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

export default function ContestForm({ initial = emptyForm, locked, submitLabel, existingTheme, hasExistingPassword = false, isOwner = true, onSubmit }:
  { initial?: FormValues; locked: boolean; submitLabel: string; existingTheme?: Record<string, unknown>; hasExistingPassword?: boolean; isOwner?: boolean; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const [v, setV] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => { setV((x) => ({ ...x, [k]: val })); setSaved(false); };
  const paid = v.voteType !== 'free';
  const free = v.voteType !== 'paid';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const price = Number(v.votePriceXaf);
    const choices = Number(v.maxChoicesPerVote);
    const freeVotes = Number(v.freeVotesPerPeriod);
    const period = Number(v.freeVotePeriodHours);
    if (v.startsAt && v.endsAt && new Date(v.endsAt).getTime() <= new Date(v.startsAt).getTime()) {
      setError('La date de fin doit être postérieure à la date de début.');
      return;
    }
    if (!locked && paid && (!Number.isInteger(price) || price < 100)) {
      setError('Le prix d’un vote payant doit être un nombre entier d’au moins 100 FCFA.');
      return;
    }
    if (!Number.isInteger(choices) || choices < 1 || choices > 50) {
      setError('Le nombre maximum de candidats par vote doit être compris entre 1 et 50.');
      return;
    }
    if (free && (!Number.isInteger(freeVotes) || freeVotes < 0 || freeVotes > 100)) {
      setError('Le nombre de votes gratuits doit être compris entre 0 et 100.');
      return;
    }
    if (free && (!Number.isInteger(period) || period < 1 || period > 720)) {
      setError('La période des votes gratuits doit être comprise entre 1 et 720 heures.');
      return;
    }
    if (v.visibility === 'private' && !hasExistingPassword && v.accessPassword.trim().length < 4) {
      setError('Un mot de passe de 4 caractères minimum est obligatoire pour un concours privé.');
      return;
    }
    setBusy(true);
    try { await onSubmit(buildPayload(v, { locked, existingTheme })); setSaved(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'); }
    finally { setBusy(false); }
  };

  return (
    <form className="form" onSubmit={submit}>
      {!isOwner && <p className="muted small">Les paramètres de vote, les tarifs, les dates et la visibilité sont réservés au propriétaire du concours.</p>}
      <L label="Nom du concours *"><input className="input" required minLength={3} maxLength={120} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Miss Yaoundé 2026" /></L>
      <L label="Organisateur"><input className="input" maxLength={120} value={v.organizerName} onChange={(e) => set('organizerName', e.target.value)} placeholder="Nom de votre structure" /></L>
      <L label="Catégorie" hint="Facultatif : beauté, sport, culture, entrepreneuriat…"><input className="input" maxLength={80} value={v.category} onChange={(e) => set('category', e.target.value)} placeholder="Ex. : Beauté et culture" /></L>
      <L label="Description"><textarea className="input" rows={3} maxLength={5000} value={v.description} onChange={(e) => set('description', e.target.value)} /></L>
      <L label="Règlement du concours" hint="Obligatoire avant publication."><textarea className="input" rows={4} maxLength={20000} value={v.rules} onChange={(e) => set('rules', e.target.value)} /></L>

            <section className="form-section" aria-labelledby="site-identity-heading">
        <div className="form-section-heading"><h2 id="site-identity-heading">Contenu du mini-site public</h2><p>Ces informations seront visibles sur le site indépendant de votre concours.</p></div>
        <L label="Slogan"><input className="input" maxLength={180} value={v.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Une phrase qui présente votre concours" /></L>
        <L label="Concept du concours"><textarea className="input" rows={4} maxLength={5000} value={v.concept} onChange={(e) => set('concept', e.target.value)} placeholder="Présentez le concept et le déroulement du concours." /></L>
        <L label="Objectifs"><textarea className="input" rows={3} maxLength={3000} value={v.objectives} onChange={(e) => set('objectives', e.target.value)} placeholder="Quels sont les objectifs de cette compétition ?" /></L>
        <div className="two">
          <L label="Lieu / zone géographique"><input className="input" maxLength={180} value={v.location} onChange={(e) => set('location', e.target.value)} placeholder="Yaoundé, Cameroun" /></L>
          <L label="Conditions d’éligibilité"><textarea className="input" rows={2} maxLength={2000} value={v.eligibility} onChange={(e) => set('eligibility', e.target.value)} /></L>
        </div>
        <div className="two">
          <L label="Email de contact"><input className="input" type="email" maxLength={254} value={v.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></L>
          <L label="Téléphone de contact"><input className="input" type="tel" maxLength={32} value={v.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></L>
        </div>
        <div className="two">
          <L label="Site web"><input className="input" type="url" maxLength={500} value={v.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://" /></L>
          <L label="Instagram"><input className="input" type="url" maxLength={500} value={v.instagramUrl} onChange={(e) => set('instagramUrl', e.target.value)} placeholder="https://" /></L>
        </div>
        <L label="Facebook"><input className="input" type="url" maxLength={500} value={v.facebookUrl} onChange={(e) => set('facebookUrl', e.target.value)} placeholder="https://" /></L>
      </section>

<fieldset className="group" disabled={locked || !isOwner}>
        <legend>Type de vote {locked && <small className="muted">(verrouillé après publication)</small>}</legend>
        <div className="radios">
          {([['free', 'Gratuit'], ['paid', 'Payant'], ['mixed', 'Mixte']] as const).map(([k, label]) => (
            <label key={k} className={v.voteType === k ? 'on' : ''}><input type="radio" name="voteType" checked={v.voteType === k} onChange={() => set('voteType', k)} />{label}</label>
          ))}
        </div>
        {paid && <L label="Prix d'un vote (FCFA)" hint="Un minimum fixé par la plateforme s'applique (100 FCFA). Commission VOTALLY : 8 %.">
          <input className="input" type="number" min={100} step={1} inputMode="numeric" required value={v.votePriceXaf} onChange={(e) => set('votePriceXaf', e.target.value)} /></L>}
        <L label="Candidats par vote (maximum)"><input className="input" type="number" min={1} max={50} step={1} required value={v.maxChoicesPerVote} onChange={(e) => set('maxChoicesPerVote', e.target.value)} /></L>
      </fieldset>

      {free && (
        <div className="two">
          <L label="Votes gratuits par numéro"><input className="input" type="number" min={0} max={100} step={1} required disabled={!isOwner} value={v.freeVotesPerPeriod} onChange={(e) => set('freeVotesPerPeriod', e.target.value)} /></L>
          <L label="…toutes les (heures)"><input className="input" type="number" min={1} max={720} step={1} required disabled={!isOwner} value={v.freeVotePeriodHours} onChange={(e) => set('freeVotePeriodHours', e.target.value)} /></L>
        </div>
      )}
      <div className="two">
        <L label="Début du vote"><input className="input" type="datetime-local" disabled={!isOwner} value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></L>
        <L label="Fin du vote" hint="La date de fin doit être postérieure à la date de début."><input className="input" type="datetime-local" disabled={!isOwner} value={v.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></L>
      </div>
      <div className="two">
        <L label="Résultats"><select className="input" disabled={!isOwner} value={v.resultsDisplay} onChange={(e) => set('resultsDisplay', e.target.value as FormValues['resultsDisplay'])}>
          <option value="realtime">Publics en temps réel</option><option value="on_close">Publics à la clôture</option><option value="hidden">Non publics</option></select></L>
        <L label="Langue par défaut"><select className="input" value={v.defaultLocale} onChange={(e) => set('defaultLocale', e.target.value as 'fr' | 'en')}>
          <option value="fr">Français</option><option value="en">English</option></select></L>
      </div>
      <div className="two">
        <L label="Accès"><select className="input" disabled={!isOwner} value={v.visibility} onChange={(e) => set('visibility', e.target.value as 'public' | 'private')}>
          <option value="public">Public</option><option value="private">Privé (mot de passe)</option></select></L>
        {v.visibility === 'private' && <L label="Mot de passe" hint={hasExistingPassword ? 'Laisser vide pour conserver le mot de passe actuel.' : 'Obligatoire pour protéger un concours privé.'}><input className="input" type="password" disabled={!isOwner} autoComplete="new-password" minLength={4} maxLength={100} required={!hasExistingPassword} value={v.accessPassword} onChange={(e) => set('accessPassword', e.target.value)} /></L>}
      </div>
      <section className="form-section" aria-labelledby="site-template-heading">
        <div className="form-section-heading"><h2 id="site-template-heading">Présentation du mini-site</h2><p>Choisissez une composition adaptée à l'identité de votre compétition. Les informations et les règles de vote restent les mêmes.</p></div>
        <L label="Modèle visuel">
          <select className="input" value={v.template} onChange={(e) => set('template', e.target.value as FormValues['template'])}>
            <option value="editorial">Éditorial — présentation complète</option>
            <option value="spotlight">Spotlight — visuel et candidats au premier plan</option>
            <option value="minimal">Minimal — design épuré et direct</option>
          </select>
        </L>
        <L label="Couleur principale"><input className="color" type="color" value={v.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></L>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button>
        {saved && <span className="ok-text" role="status">✓ Enregistré</span>}
      </div>
    </form>
  );
}
