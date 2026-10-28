'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/client';

export default function Invitation() {
  const [state, setState] = useState<{ kind: 'wait' } | { kind: 'ok'; contestId: string } | { kind: 'error'; message: string }>({ kind: 'wait' });
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setState({ kind: 'error', message: 'Lien d\'invitation incomplet.' }); return; }
    api<{ contestId: string }>('/contests/invitations/accept', { body: { token } })
      .then((r) => setState({ kind: 'ok', contestId: r.contestId }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) window.location.replace(`/connexion?next=${encodeURIComponent('/invitation?token=' + token)}`);
        else setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Erreur' });
      });
  }, []);
  return (
    <main className="authbox"><p className="brand center">VOTALLY</p>
      <div className="panel center">
        {state.kind === 'wait' && <p className="muted">Validation de l&apos;invitation…</p>}
        {state.kind === 'ok' && <><div className="ok">✓</div><h1>Invitation acceptée</h1><Link className="btn btn-primary" href={`/espace/${state.contestId}`}>Ouvrir le concours</Link></>}
        {state.kind === 'error' && <><div className="ko">!</div><h1>Invitation impossible</h1><p className="muted">{state.message}</p><Link className="btn btn-ghost" href="/espace">Mes concours</Link></>}
      </div></main>
  );
}
