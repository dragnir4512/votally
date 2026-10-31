'use client';
import { useState } from 'react';
import { api, ApiError } from '../../lib/client';
import { mediaUrl } from '../../lib/format';
import { uploadFile } from '../../lib/upload';
import { parseBulk, type MyCandidate, type MyContest } from '../../lib/creator';

export default function CandidatesTab({ contest, candidates, canEdit, reload }: { contest: MyContest; candidates: MyCandidate[]; canEdit: boolean; reload: () => Promise<void> }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [bulk, setBulk] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const base = `/contests/${contest.id}/candidates`;
  const isDraft = contest.status === 'draft';
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await reload(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Erreur'); } finally { setBusy(false); } };

  const addOne = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await api(base, { body: { name: name.trim(), description: desc.trim() || null } }); setName(''); setDesc(''); }); };
  const addBulk = () => { const list = parseBulk(bulk); if (!list.length) return; run(async () => { await api(base, { body: list }); setBulk(''); }); };
  const save = () => edit && run(async () => { await api(`${base}/${edit.id}`, { method: 'PATCH', body: { name: edit.name.trim(), description: edit.description.trim() || null } }); setEdit(null); });
  const photo = (c: MyCandidate, file: File | undefined) => file && run(() => uploadFile(`${base}/${c.id}/image`, file));
  const toggle = (c: MyCandidate) => run(() => api(`${base}/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }));
  const remove = (c: MyCandidate) => { if (window.confirm(`Supprimer « ${c.name} » ?`)) run(() => api(`${base}/${c.id}`, { method: 'DELETE' })); };

  return (
    <section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="tablewrap"><table className="table">
        <thead><tr><th>N°</th><th>Photo</th><th>Nom</th><th>Statut</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {candidates.length === 0 && <tr><td colSpan={5} className="muted">Aucun candidat pour l&apos;instant.</td></tr>}
          {candidates.map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'off'}>
              <td>{c.number}</td>
              <td className="thumbcell">{mediaUrl(c.imageKey) ? <img className="thumb" src={mediaUrl(c.imageKey)!} alt="" width={48} height={48} /> : <span className="thumb ph0" aria-hidden>{c.name.slice(0, 1)}</span>}
                {canEdit && <label className="btn btn-ghost sm filebtn">{c.imageKey ? 'Changer' : 'Ajouter'}<input type="file" accept="image/*" hidden onChange={(e) => { photo(c, e.target.files?.[0]); e.target.value = ''; }} /></label>}</td>
              <td>{edit?.id === c.id
                ? <div className="stack"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Nom" />
                    <input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" placeholder="Description" /></div>
                : <><strong>{c.name}</strong>{c.description && <div className="muted small">{c.description}</div>}</>}</td>
              <td>{c.isActive ? 'Actif' : 'Désactivé'}</td>
              {canEdit && <td className="rowbtns">
                {edit?.id === c.id
                  ? <><button className="btn btn-primary sm" type="button" disabled={busy} onClick={save}>OK</button><button className="btn btn-ghost sm" type="button" onClick={() => setEdit(null)}>Annuler</button></>
                  : <><button className="btn btn-ghost sm" type="button" onClick={() => setEdit({ id: c.id, name: c.name, description: c.description ?? '' })}>Modifier</button>
                      <button className="btn btn-ghost sm" type="button" disabled={busy} onClick={() => toggle(c)}>{c.isActive ? 'Désactiver' : 'Activer'}</button>
                      {isDraft && <button className="btn btn-ghost sm danger" type="button" disabled={busy} onClick={() => remove(c)}>Supprimer</button>}</>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {!isDraft && <p className="muted small">Après publication, un candidat ne peut plus être supprimé (son historique de votes est conservé) : désactive-le à la place.</p>}

      {canEdit && (
        <>
          <form className="panel" onSubmit={addOne}>
            <h3>Ajouter un candidat</h3>
            <label className="field"><span>Nom *</span><input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Description</span><input className="input" maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
            <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>Ajouter</button>
            <p className="muted small">Ajoute les photos depuis la liste ci-dessus après avoir créé les candidats (JPEG, PNG ou WebP, 8 Mo maximum ; recadrées automatiquement en carré).</p>
          </form>
          <div className="panel">
            <h3>Importer une liste</h3>
            <p className="muted small">Un candidat par ligne : <code>Nom ; description (facultatif)</code>. Tu peux coller depuis Excel.</p>
            <textarea className="input" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Aïcha Mbarga ; Étudiante, 22 ans\nBrenda Tchoua'} aria-label="Liste de candidats" />
            <button className="btn btn-outline" type="button" disabled={busy || !parseBulk(bulk).length} onClick={addBulk}>Importer {parseBulk(bulk).length || ''} candidat(s)</button>
          </div>
        </>
      )}
    </section>
  );
}
