'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/client';

type Contacts = { email: string | null; emailVerified: boolean; phone: string | null; phoneVerified: boolean };
export default function ContactChannels() {
  const [contacts, setContacts] = useState<Contacts | null>(null);
  const [channel, setChannel] = useState<'email' | 'sms'>('sms');
  const [target, setTarget] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { const r = await api<{ contacts: Contacts }>('/me/contacts'); setContacts(r.contacts); };
  useEffect(() => { void load().catch(() => setError('Impossible de charger les coordonnées.')); }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'); } finally { setBusy(false); } };
  const request = () => run(async () => {
    const r = await api<{ challenge: string; devCode?: string; message: string }>('/me/contacts/challenge', { body: { channel, target } });
    setChallenge(r.challenge); setDevCode(r.devCode ?? ''); setMessage(r.message);
  });
  const verify = () => run(async () => {
    await api('/me/contacts/verify', { body: { challenge, code } });
    setChallenge(''); setCode(''); setTarget(''); setDevCode(''); setMessage('Coordonnée ajoutée et vérifiée.'); await load();
  });
  if (!contacts) return <p className="muted">Chargement des coordonnées…</p>;
  return <section className="account-section">
    <div className="account-section-heading"><div><span className="account-section-kicker">SÉCURITÉ DU COMPTE</span><h2>Canaux de contact</h2><p>Ajoute et vérifie une deuxième coordonnée pour choisir entre email et SMS à la connexion et lors des retraits.</p></div></div>
    <div className="account-identity-card" style={{ display: 'block' }}>
      <p><strong>Email :</strong> {contacts.email ?? 'Non renseigné'} · {contacts.emailVerified ? 'Vérifié' : 'Non vérifié'}</p>
      <p><strong>Téléphone :</strong> {contacts.phone ?? 'Non renseigné'} · {contacts.phoneVerified ? 'Vérifié' : 'Non vérifié'}</p>
    </div>
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="tabs"><button type="button" className={channel === 'email' ? 'on' : ''} onClick={() => { setChannel('email'); setChallenge(''); }}>Ajouter un email</button><button type="button" className={channel === 'sms' ? 'on' : ''} onClick={() => { setChannel('sms'); setChallenge(''); }}>Ajouter un téléphone</button></div>
      {!challenge ? <>
        <label className="field"><span>{channel === 'email' ? 'Adresse email' : 'Numéro de téléphone'}</span><input className="input" type={channel === 'email' ? 'email' : 'tel'} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={channel === 'email' ? 'vous@exemple.com' : '+237 6XXXXXXXX'} /></label>
        <button className="btn btn-primary" type="button" disabled={busy || !target.trim()} onClick={request}>Envoyer le code de vérification</button>
      </> : <>
        <p className="muted">Code envoyé. Saisis le code reçu pour valider cette coordonnée.</p>
        {devCode && <p className="devhint">Mode développement : code {devCode}</p>}
        <label className="field"><span>Code à 6 chiffres</span><input className="input code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="btn btn-primary" type="button" disabled={busy || code.length !== 6} onClick={verify}>Vérifier la coordonnée</button>
      </>}
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>;
}
