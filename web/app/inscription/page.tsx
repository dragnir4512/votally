'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '../../lib/client';

export default function Inscription() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [by, setBy] = useState<'email' | 'phone'>('email');
  const [f, setF] = useState({ fullName: '', contact: '', password: '', accept: false });
  const [code, setCode] = useState(''); const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const target = { [by]: f.contact.trim() };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? (e.details ?? e.message) : 'Erreur'); } finally { setBusy(false); } };

  const register = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api<{ devCode?: string }>('/auth/register', { body: { ...target, password: f.password, fullName: f.fullName.trim(), acceptTerms: f.accept } });
    setDevCode(r.devCode ?? null); setStep('code'); }); };
  const verify = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await api('/auth/verify', { body: { ...target, code } }); router.replace('/espace'); }); };

  return (
    <main className="authbox auth-page auth-register">
      <a className="auth-brand" href="/"> <span className="brand-mark">V</span> VOTALLY </a>
      {step === 'form' ? (
        <form className="panel auth-card" onSubmit={register}>
          <span className="auth-eyebrow">REJOIGNEZ VOTALLY</span><h1>Créez votre compte.</h1><p className="auth-intro">Lancez et gérez vos concours depuis un espace unique.</p>
          <div className="tabs"><button type="button" className={by === 'email' ? 'on' : ''} onClick={() => setBy('email')}>Email</button>
            <button type="button" className={by === 'phone' ? 'on' : ''} onClick={() => setBy('phone')}>Téléphone</button></div>
          <label className="field"><span>Nom complet</span><input className="input" required minLength={2} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
          <label className="field"><span>{by === 'email' ? 'Email' : 'Téléphone (Mobile Money de préférence)'}</span>
            <input className="input" required type={by === 'email' ? 'email' : 'tel'} autoComplete={by === 'email' ? 'email' : 'tel'} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder={by === 'email' ? 'vous@exemple.com' : '690000000'} /></label>
          <label className="field"><span>Mot de passe</span><input className="input" required type="password" minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <small className="muted">8 caractères minimum, avec une majuscule et un chiffre.</small></label>
          <label className="check-line"><input type="checkbox" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} /> J&apos;accepte les conditions d&apos;utilisation et la politique de confidentialité.</label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary block" type="submit" disabled={busy || !f.accept}>Recevoir mon code</button>
          <p className="center small">Déjà inscrit ? <Link href="/connexion">Se connecter</Link></p>
        </form>
      ) : (
        <form className="panel auth-card" onSubmit={verify}>
          <span className="auth-eyebrow">SÉCURITÉ DU COMPTE</span><h1>Vérifiez votre identité.</h1><p className="auth-intro">Une dernière étape avant d’accéder à votre espace.</p>
          <p className="muted">Saisis le code à 6 chiffres envoyé à <strong>{f.contact}</strong>.</p>
          {devCode && <p className="devhint">Mode test : code {devCode}</p>}
          <input className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code de vérification" />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary block" type="submit" disabled={busy || code.length !== 6}>Valider</button>
          <button className="btn btn-link block" type="button" onClick={() => { setStep('form'); setCode(''); setError(null); }}>Modifier mes informations</button>
        </form>
      )}
    </main>
  );
}
