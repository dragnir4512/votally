'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { safeNext } from '../../lib/session';

type Method = { channel: 'email' | 'sms'; masked: string };
export default function Connexion() {
  const router = useRouter();
  const [id, setId] = useState(''); const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(''); const [methods, setMethods] = useState<Method[]>([]);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [code, setCode] = useState(''); const [devCode, setDevCode] = useState('');
  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const isEmail = id.includes('@');
    try {
      const r = await api<{ challenge: string; methods: Method[] }>('/auth/login', { body: { [isEmail ? 'email' : 'phone']: id.trim(), password } });
      setChallenge(r.challenge); setMethods(r.methods); setChannel(r.methods[0].channel); setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'unverified' ? 'Compte non vérifié : termine ton inscription avec le code reçu.' : err.message) : 'Erreur de connexion');
    } finally { setBusy(false); }
  };
  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/login/send-code', { body: { challenge, channel } });
      setDevCode(r.devCode ?? '');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Impossible d’envoyer le code.'); }
    finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api('/auth/login/verify', { body: { challenge, channel, code } });
      router.replace(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Code invalide ou expiré.'); }
    finally { setBusy(false); }
  };
  return (
    <main className="authbox auth-page">
      <a className="auth-brand" href="/"> <span className="brand-mark">V</span> VOTALLY </a>
      {step === 'credentials' ? <form className="panel auth-card" onSubmit={submit}>
        <span className="auth-eyebrow">ESPACE PERSONNEL</span><h1>Heureux de vous revoir.</h1><p className="auth-intro">Connectez-vous pour gérer vos concours et suivre vos activités.</p>
        <label className="field"><span>Email ou téléphone</span><input className="input" required autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="vous@exemple.com ou 690000000" /></label>
        <label className="field"><span>Mot de passe</span><input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <p className="small"><Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link></p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary block" type="submit" disabled={busy}>{busy ? 'Vérification…' : 'Continuer'}</button>
        <p className="center small">Pas encore de compte ? <Link href="/inscription">Créer un compte</Link></p>
      </form> : <form className="panel auth-card" onSubmit={verify}>
        <span className="auth-eyebrow">AUTHENTIFICATION À DEUX ÉTAPES</span><h1>Confirmez votre connexion.</h1>
        <p className="auth-intro">Choisis où recevoir ton code de sécurité.</p>
        <div className="tabs">{methods.map((m) => <button key={m.channel} type="button" className={channel === m.channel ? 'on' : ''} onClick={() => { setChannel(m.channel); setDevCode(''); setCode(''); }}>{m.channel === 'email' ? 'Email' : 'SMS'} · {m.masked}</button>)}</div>
        <button className="btn btn-secondary block" type="button" disabled={busy} onClick={sendCode}>{busy ? 'Envoi…' : 'Envoyer le code'}</button>
        {devCode && <p className="devhint">Mode développement : code {devCode}</p>}
        <label className="field"><span>Code à 6 chiffres</span><input className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary block" type="submit" disabled={busy || code.length !== 6}>Valider et se connecter</button>
        <button className="btn btn-link block" type="button" disabled={busy} onClick={() => { setStep('credentials'); setCode(''); setError(null); }}>Retour</button>
      </form>}
    </main>
  );
}
