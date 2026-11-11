'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { mediaUrl } from '../../lib/format';
import { uploadFile } from '../../lib/upload';
import { formFromContest, xaf, type MyContest, type Pack } from '../../lib/creator';
import ContestForm from './ContestForm';

export default function SettingsTab({ contest, canEdit, isOwner, reload }: { contest: MyContest; canEdit: boolean; isOwner: boolean; reload: () => Promise<void> }) {
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [votes, setVotes] = useState(''); const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasPaid = contest.voteType !== 'free';
  const loadPacks = () => api<{ packs: Pack[] }>(`/contests/${contest.id}/packs`).then((r) => setPacks(r.packs)).catch(() => undefined);
  useEffect(() => { if (hasPaid) loadPacks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [contest.id, hasPaid]);

  const addPack = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api(`/contests/${contest.id}/packs`, { body: { votesCount: Number(votes), priceXaf: Number(price) } }); setVotes(''); setPrice(''); await loadPacks(); }
    catch (err) { setError(err instanceof ApiError ? (err.code === 'conflict' ? 'Un pack de ce nombre de votes existe déjà.' : err.message) : 'Erreur'); }
  };
  const removePack = async (p: Pack) => { await api(`/contests/${contest.id}/packs/${p.id}`, { method: 'DELETE' }); await loadPacks(); };
  const deleteDraft = async () => {
    if (!window.confirm('Supprimer définitivement ce brouillon ?')) return;
    try { await api(`/contests/${contest.id}`, { method: 'DELETE' }); router.push('/espace'); } catch (err) { setError(err instanceof ApiError ? err.message : 'Erreur'); }
  };

  const logo = async (file: File | undefined) => {
    if (!file) return; setError(null);
    try { await uploadFile(`/contests/${contest.id}/logo`, file); await reload(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Erreur'); }
  };

  const banner = async (file: File | undefined) => {
    if (!file) return; setError(null);
    try { await uploadFile(`/contests/${contest.id}/banner`, file); await reload(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Erreur'); }
  };

  if (!canEdit) return <p className="muted">Seuls le propriétaire et les gestionnaires peuvent modifier les paramètres.</p>;
  return (
    <section>
      <div className="panel">
        <h3>Logo du concours</h3>
        {typeof contest.theme?.logoKey === 'string' && <img className="contest-logo-preview" src={mediaUrl(contest.theme.logoKey) ?? undefined} alt="Logo du concours" />}
        <label className="btn btn-outline sm filebtn">{typeof contest.theme?.logoKey === 'string' ? 'Changer le logo' : 'Ajouter un logo'}<input type="file" accept="image/*" hidden onChange={(e) => { logo(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <p className="muted small">Image carrée, recadrée automatiquement en WebP.</p>
      </div>
      <div className="panel">
        <h3>Bannière</h3>
        {contest.bannerKey && <img className="bannerprev" src={mediaUrl(contest.bannerKey)!} alt="Bannière du concours" />}
        <label className="btn btn-outline sm filebtn">{contest.bannerKey ? 'Changer la bannière' : 'Ajouter une bannière'}<input type="file" accept="image/*" hidden onChange={(e) => { banner(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <p className="muted small">Image large (idéalement 1600×600). Recadrée automatiquement.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <div className="panel">
        <ContestForm initial={formFromContest(contest)} locked={contest.status !== 'draft'} existingTheme={contest.theme} hasExistingPassword={contest.hasPassword} submitLabel="Enregistrer"
          onSubmit={async (body) => { await api(`/contests/${contest.id}`, { method: 'PATCH', body }); await reload(); }} />
      </div>

      {hasPaid && (
        <div className="panel">
          <h3>Packs de votes</h3>
          <p className="muted small">Prix unitaire : {xaf(contest.votePriceXaf)}. Un pack offre une remise (ex. 10 votes pour 900 FCFA).</p>
          <ul className="plain">{packs.length === 0 && <li className="muted">Aucun pack.</li>}
            {packs.map((p) => <li key={p.id}><strong>{p.votesCount} votes</strong> — {xaf(p.priceXaf)} <button type="button" className="btn btn-ghost sm danger" onClick={() => removePack(p)}>Retirer</button></li>)}</ul>
          <form className="two" onSubmit={addPack}>
            <label className="field"><span>Nombre de votes</span><input className="input" type="number" min={2} required value={votes} onChange={(e) => setVotes(e.target.value)} /></label>
            <label className="field"><span>Prix du pack (FCFA)</span><input className="input" type="number" min={1} required value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <button className="btn btn-outline" type="submit">Ajouter le pack</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}

      {isOwner && contest.status === 'draft' && (
        <div className="panel danger-zone"><h3>Zone sensible</h3><button type="button" className="btn btn-ghost danger" onClick={deleteDraft}>Supprimer ce brouillon</button></div>
      )}
    </section>
  );
}
