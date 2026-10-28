'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../../lib/client';
import { RequireAuth, useMe } from '../../lib/session';

function Header() {
  const me = useMe(); const router = useRouter();
  const logout = async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined); router.push('/connexion'); };
  return (
    <header className="top"><div className="top-in">
      <Link href="/espace" className="brand">VOTALLY</Link>
      <nav className="who"><span className="muted small">{me.fullName ?? me.email ?? me.phone}</span>
        <button type="button" className="btn btn-ghost" onClick={logout}>Déconnexion</button></nav>
    </div></header>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return <RequireAuth><Header /><main className="shell">{children}</main></RequireAuth>;
}
