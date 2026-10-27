import 'server-only';
import { headers } from 'next/headers';
import type { ContestPage } from './types';

const API = process.env.API_URL ?? 'http://localhost:3000';

export type Loaded = { kind: 'ok'; data: ContestPage } | { kind: 'notfound' } | { kind: 'private' };

export async function loadContest(slug: string): Promise<Loaded> {
  const res = await fetch(`${API}/public/contests/${encodeURIComponent(slug)}`, { next: { revalidate: 10 } });
  if (res.status === 404) return { kind: 'notfound' };
  if (res.status === 401) return { kind: 'private' };
  if (!res.ok) throw new Error(`API ${res.status}`);
  return { kind: 'ok', data: (await res.json()) as ContestPage };
}

/** Préfixe des liens : vide sur slug.domaine (sous-domaine), /slug sinon (accès direct par chemin). */
export async function linkBase(slug: string): Promise<string> {
  const host = ((await headers()).get('host') ?? '').toLowerCase();
  return host.startsWith(`${slug.toLowerCase()}.`) ? '' : `/${slug}`;
}
