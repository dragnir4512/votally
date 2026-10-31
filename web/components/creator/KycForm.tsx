'use client';
import { useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { uploadFile } from '../../lib/upload';

export default function KycForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [type, setType] = useState<'individual' | 'organization'>('individual');
  const [f, setF] = useState({ legalName: '', idDocumentType: 'cni', niu: '', payoutMethod: 'mtn_momo', payoutPhone: '', payoutAccountName: '' });
  const [idFile, setIdFile] = useState<File | null>(null); const [orgFile, setOrgFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const id = await uploadFile<{ key: string }>('/me/kyc/documents?kind=id', idFile!, 'document');
      const org = type === 'organization' && orgFile ? await uploadFile<{ key: string }>('/me/kyc/documents?kind=org', orgFile, 'document') : null;
      await api('/me/kyc', { body: { type, legalName: f.legalName, idDocumentType: f.idDocumentType, idDocumentKey: id.key,
        organizationDocKeys: org ? { 'Récépissé ou RCCM': org.key } : {}, niu: f.niu.trim() || null,
        payoutMethod: f.payoutMethod, payoutPhone: f.payoutPhone, payoutAccountName: f.payoutAccountName || f.legalName } });
      onSubmitted();
    } catch (err) { setError(err instanceof ApiError ? (err.details ?? err.message) : 'Erreur'); } finally { setBusy(false); }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h3>Vérifier mon identité</h3>
      <p className="muted small">Obligatoire une seule fois, avant le premier retrait. Tes pièces sont stockées de façon privée et ne sont consultées que par l&apos;équipe VOTALLY pour cette vérification. Réponse sous 48 h ouvrées.</p>
      <div className="radios"><label className={type === 'individual' ? 'on' : ''}><input type="radio" name="t" checked={type === 'individual'} onChange={() => setType('individual')} />Personne</label>
        <label className={type === 'organization' ? 'on' : ''}><input type="radio" name="t" checked={type === 'organization'} onChange={() => setType('organization')} />Organisation</label></div>
      <label className="field"><span>{type === 'individual' ? 'Nom et prénom (comme sur la pièce)' : 'Nom du représentant (comme sur la pièce)'}</span><input className="input" required minLength={3} value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></label>
      <div className="two">
        <label className="field"><span>Pièce</span><select className="input" value={f.idDocumentType} onChange={(e) => set('idDocumentType', e.target.value)}><option value="cni">Carte nationale d&apos;identité</option><option value="passport">Passeport</option></select></label>
        <label className="field"><span>Photo ou scan de la pièce *</span><input className="input" type="file" accept="image/*,application/pdf" required onChange={(e) => setIdFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      {type === 'organization' && (
        <div className="two">
          <label className="field"><span>Récépissé de déclaration ou RCCM *</span><input className="input" type="file" accept="image/*,application/pdf" required onChange={(e) => setOrgFile(e.target.files?.[0] ?? null)} /></label>
          <label className="field"><span>NIU</span><input className="input" value={f.niu} onChange={(e) => set('niu', e.target.value)} /></label>
        </div>
      )}
      <fieldset className="group"><legend>Compte Mobile Money qui recevra l&apos;argent</legend>
        <div className="two">
          <label className="field"><span>Opérateur</span><select className="input" value={f.payoutMethod} onChange={(e) => set('payoutMethod', e.target.value)}><option value="mtn_momo">MTN MoMo</option><option value="orange_money">Orange Money</option></select></label>
          <label className="field"><span>Numéro</span><input className="input" type="tel" required value={f.payoutPhone} onChange={(e) => set('payoutPhone', e.target.value)} placeholder="677000000" /></label>
        </div>
        <label className="field"><span>Nom du titulaire du compte</span><input className="input" value={f.payoutAccountName} onChange={(e) => set('payoutAccountName', e.target.value)} placeholder={f.legalName || 'Doit correspondre à ta pièce'} />
          <small className="muted">Le compte doit être à ton nom : sinon la demande sera refusée.</small></label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy || !idFile || (type === 'organization' && !orgFile)}>{busy ? 'Envoi…' : 'Envoyer mon dossier'}</button>
    </form>
  );
}
