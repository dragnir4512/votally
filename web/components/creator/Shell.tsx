'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../../lib/client';
import { RequireAuth, useMe } from '../../lib/session';

function Header() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.push('/connexion');
  };
  const links = [
    { href: '/espace', label: 'Tableau de bord', short: 'Accueil' },
    { href: '/espace/compte', label: 'Mon compte', short: 'Compte' },
    { href: '/espace/securite', label: 'Sécurité', short: 'Sécurité' },
  ];
  return (
    <header className="creator-top">
      <div className="creator-top-inner">
        <Link href="/espace" className="creator-brand"><span className="creator-brand-mark">V</span><span>VOTALLY</span></Link>
        <nav className="creator-nav" aria-label="Navigation organisateur">
          {links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? 'active' : ''}>{link.label}</Link>)}
          {me.role === 'admin' && <Link href="/admin" className={pathname.startsWith('/admin') ? 'active' : ''}>Administration</Link>}
        </nav>
        <div className="creator-user">
          <span className="creator-user-name">{me.fullName || me.email || me.phone || 'Mon compte'}</span>
          <button type="button" className="creator-logout" onClick={logout}>Déconnexion</button>
        </div>
      </div>
    </header>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return <RequireAuth><div className="creator-app"><Header /><main className="creator-shell">{children}</main><footer className="creator-footer">© {new Date().getFullYear()} VOTALLY <span>Votre espace organisateur</span></footer></div></RequireAuth>;
}
