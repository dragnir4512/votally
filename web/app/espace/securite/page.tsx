'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/client';

type Session = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
const date = (value: string) => new Date(value).toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' });
function deviceLabel(ua: string | null) {
  if (!ua) return 'Appareil inconnu';
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /Chrome\//.test(ua) ? 'Google Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Système inconnu';
  return browser + ' · ' + os;
}
export default function SecuriteCompte() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { const r = await api<{ sessions: Session[] }>('/auth/sessions'); setSessions(r.sessions); }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossible de charger les sessions.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const revoke = async (id: string) => {
    if (!window.confirm('Déconnecter cet appareil ?')) return;
    setBusy(id);
    try { await api('/auth/sessions/' + id, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'La révocation a échoué.'); }
    finally { setBusy(''); }
  };
  const revokeOthers = async () => {
    if (!window.confirm('Déconnecter tous les autres appareils ?')) return;
    setBusy('others');
    try { await api('/auth/sessions/revoke-others', { method: 'POST', body: {} }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'La révocation a échoué.'); }
    finally { setBusy(''); }
  };
  const revokeAll = async () => {
    if (!window.confirm('Déconnecter tous les appareils, y compris celui-ci ? Tu devras te reconnecter.')) return;
    setBusy('all');
    try { await api('/auth/sessions/revoke-all', { method: 'POST', body: {} }); window.location.assign('/connexion'); }
    catch (e) { setError(e instanceof Error ? e.message : 'La révocation a échoué.'); setBusy(''); }
  };
  return <div className="account-page">
    <p className="account-breadcrumb"><Link href="/espace/compte">← Retour à mon compte</Link></p>
    <header className="account-heading"><div><p className="account-eyebrow">ESPACE ORGANISATEUR / SÉCURITÉ</p><h1>Appareils connectés</h1><p>Consulte les sessions ouvertes sur ton compte et déconnecte les appareils que tu ne reconnais pas.</p></div></header>
    <section className="account-section">
      <div className="account-section-heading"><div><span className="account-section-kicker">SESSIONS ACTIVES</span><h2>Connexions à ton compte</h2><p>Chaque session expire au plus tard 30 jours après sa création. Les accès sont renouvelés automatiquement pendant l’utilisation.</p></div>
        <div><button className="btn btn-secondary" type="button" disabled={!!busy || sessions.length < 2} onClick={revokeOthers}>{busy === 'others' ? 'Déconnexion…' : 'Déconnecter les autres'}</button></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Chargement des sessions…</p>}
      {!loading && sessions.length === 0 && <p className="muted">Aucune session active trouvée.</p>}
      <div className="account-identity-card" style={{ display: 'block' }}>
        {sessions.map((s) => <article key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
          <div><strong>{deviceLabel(s.userAgent)} {s.current && <span className="account-verified-label">· Cet appareil</span>}</strong>
            <p className="muted small">Dernière activité : {date(s.lastSeenAt)}</p><p className="muted small">Connexion : {date(s.createdAt)} · Expire : {date(s.expiresAt)}</p>
            {s.ipAddress && <p className="muted small">Adresse IP : {s.ipAddress}</p>}</div>
          <button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => revoke(s.id)}>{busy === s.id ? 'Déconnexion…' : 'Déconnecter'}</button>
        </article>)}
      </div>
      <div style={{ marginTop: 24 }}><button className="btn btn-danger" type="button" disabled={!!busy || sessions.length === 0} onClick={revokeAll}>{busy === 'all' ? 'Déconnexion…' : 'Déconnecter tous les appareils'}</button></div>
    </section>
  </div>;
}
