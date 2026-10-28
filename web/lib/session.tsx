'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from './client';
import type { Me } from './creator';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

/** Protège une page : sans session valide, redirige vers /connexion?next=... */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    api<{ user: Me }>('/auth/me').then((r) => setMe(r.user)).catch(() => router.replace(`/connexion?next=${encodeURIComponent(pathname)}`)).finally(() => setChecked(true));
  }, [router, pathname]);
  if (!checked || !me) return <p className="muted center pad">Chargement…</p>;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** Redirection sûre après connexion : uniquement un chemin interne. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/espace';
}
