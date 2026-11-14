'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { ROLE_LABEL, type Member, type Role } from '../../lib/creator';

export default function TeamTab({ contestId, isOwner }: { contestId: string; isOwner: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<'manager' | 'viewer'>('viewer');
  const [link, setLink] = useState(''); const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busyMember, setBusyMember] = useState('');
  const load = useCallback(() => api<{ members: Member[] }>(`/contests/${contestId}/members`).then((r) => setMembers(r.members)).catch((e) => setError(e instanceof ApiError ? e.message : 'Impossible de charger les membres.')), [contestId]);
  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    setError(null); setCopied(false);
    try { const r = await api<{ inviteToken: string }>(`/contests/${contestId}/members/invite`, { body: { role } }); setLink(`${window.location.origin}/invitation?token=${r.inviteToken}`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Erreur lors de la création du lien.'); }
  };
  const changeRole = async (m: Member, nextRole: 'manager' | 'viewer') => {
    if (m.role === nextRole) return;
    setError(null); setBusyMember(m.id);
    try { await api(`/contests/${contestId}/members/${m.id}`, { method: 'PATCH', body: { role: nextRole } }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Impossible de modifier ce rôle.'); }
    finally { setBusyMember(''); }
  };
  const revoke = async (m: Member) => {
    if (!window.confirm('Retirer cet accès ?')) return;
    setError(null);
    try { await api(`/contests/${contestId}/members/${m.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Impossible de retirer cet accès.'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { window.prompt('Copie ce lien', link); } };

  return (
    <section>
      <div className="tablewrap"><table className="table">
        <thead><tr><th>Membre</th><th>Rôle</th><th>Statut</th>{isOwner && <th>Gestion</th>}</tr></thead>
        <tbody>{members.map((m) => (
          <tr key={m.id}>
            <td>{m.fullName ?? m.email ?? <span className="muted">Invitation en attente</span>}</td>
            <td>{isOwner && m.role !== 'owner' ? <select className="input" aria-label={`Rôle de ${m.email ?? 'ce membre'}`} value={m.role} disabled={busyMember === m.id} onChange={(e) => changeRole(m, e.target.value as 'manager' | 'viewer')}>
              <option value="viewer">Observateur</option><option value="manager">Gestionnaire</option>
            </select> : ROLE_LABEL[m.role as Role]}</td>
            <td>{m.status === 'active' ? 'Actif' : 'Invitation en attente'}</td>
            {isOwner && <td>{m.role !== 'owner' && <button type="button" className="btn btn-ghost sm danger" onClick={() => revoke(m)}>Retirer</button>}</td>}
          </tr>))}
          {members.length === 0 && <tr><td colSpan={isOwner ? 4 : 3} className="muted">Aucun collaborateur pour le moment.</td></tr>}
        </tbody></table></div>
      {isOwner ? (
        <div className="panel">
          <h3>Inviter quelqu'un</h3>
          <p className="muted small"><strong>Gestionnaire</strong> : gère les candidats, le contenu et le suivi opérationnel. Il ne peut pas modifier les paramètres structurants, les tarifs ni accéder aux montants financiers. <strong>Observateur</strong> : consultation des candidats, du classement et des indicateurs, sans modification ni données financières.</p>
          <div className="two"><label className="field"><span>Rôle</span><select className="input" value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'viewer')}>
            <option value="viewer">Observateur</option><option value="manager">Gestionnaire</option></select></label>
            <button type="button" className="btn btn-primary" onClick={invite}>Créer un lien d'invitation</button></div>
          {link && <div className="notice"><p className="small">Lien valable 7 jours, à envoyer par WhatsApp ou email. La personne doit se connecter (ou créer un compte) pour l'accepter.</p>
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lien d'invitation" />
            <button type="button" className="btn btn-outline" onClick={copy}>{copied ? 'Lien copié ✓' : 'Copier le lien'}</button></div>}
        </div>
      ) : <p className="muted small">Seul le propriétaire peut inviter, modifier les rôles ou retirer des collaborateurs.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
