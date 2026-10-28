'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { safeNext } from '../../lib/session';

export default function Connexion() {
  const router = useRouter();
  const [id, setId] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const isEmail = id.includes('@');
    try {
      await api('/auth/login', { body: { [isEmail ? 'email' : 'phone']: id.trim(), password } });
      router.replace(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'unverified' ? 'Compte non vérifié : termine ton inscription avec le code reçu.' : err.message) : 'Erreur de connexion');
    } finally { setBusy(false); }
  };
  return (
    <main className="authbox">
      <p className="brand center">VOTALLY</p>
      <form className="panel" onSubmit={submit}>
        <h1>Connexion</h1>
        <label className="field"><span>Email ou téléphone</span><input className="input" required autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="vous@exemple.com ou 690000000" /></label>
        <label className="field"><span>Mot de passe</span><input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary block" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="center small">Pas encore de compte ? <Link href="/inscription">Créer un compte</Link></p>
      </form>
    </main>
  );
}
