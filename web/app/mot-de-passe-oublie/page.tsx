'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/client';

export default function MotDePasseOublie() {
  const router = useRouter();
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = () => ({ [channel]: contact.trim() });
  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const r = await api<{ message: string; devCode?: string }>('/auth/password/forgot', { body: target() });
      setMessage(r.message); setDevCode(r.devCode ?? ''); setStep('reset');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Impossible de demander un code.'); }
    finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/password/reset', { body: { ...target(), code, newPassword } });
      router.replace('/connexion?reset=1');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'La réinitialisation a échoué.'); }
    finally { setBusy(false); }
  };
  return <main className="authbox auth-page">
    <a className="auth-brand" href="/"><span className="brand-mark">V</span> VOTALLY</a>
    {step === 'request' ? <form className="panel auth-card" onSubmit={requestCode}>
      <span className="auth-eyebrow">RÉCUPÉRATION DU COMPTE</span><h1>Mot de passe oublié ?</h1>
      <p className="auth-intro">Recevez un code de récupération sur le contact vérifié associé à votre compte.</p>
      <div className="tabs"><button type="button" className={channel === 'email' ? 'on' : ''} onClick={() => setChannel('email')}>Email</button><button type="button" className={channel === 'phone' ? 'on' : ''} onClick={() => setChannel('phone')}>Téléphone</button></div>
      <label className="field"><span>{channel === 'email' ? 'Adresse email' : 'Numéro de téléphone'}</span><input className="input" required type={channel === 'email' ? 'email' : 'tel'} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={channel === 'email' ? 'vous@exemple.com' : '690000000'} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary block" type="submit" disabled={busy || !contact.trim()}>{busy ? 'Envoi…' : 'Recevoir un code'}</button>
      <p className="center small"><Link href="/connexion">Retour à la connexion</Link></p>
    </form> : <form className="panel auth-card" onSubmit={reset}>
      <span className="auth-eyebrow">NOUVEAU MOT DE PASSE</span><h1>Réinitialisez votre accès.</h1>
      <p className="auth-intro">{message}</p>
      {devCode && <p className="devhint">Mode développement : code {devCode}</p>}
      <label className="field"><span>Code à 6 chiffres</span><input className="input code" required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\\D/g, ''))} /></label>
      <label className="field"><span>Nouveau mot de passe</span><input className="input" required type="password" minLength={10} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><small className="muted">10 caractères minimum, avec une minuscule, une majuscule et un chiffre.</small></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary block" type="submit" disabled={busy || code.length !== 6 || newPassword.length < 10}>{busy ? 'Modification…' : 'Modifier le mot de passe'}</button>
      <button className="btn btn-link block" type="button" disabled={busy} onClick={() => requestCode()}>{busy ? 'Envoi…' : 'Renvoyer un code'}</button>
    </form>}
  </main>;
}
