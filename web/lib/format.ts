import type { Lang } from './types';

export const formatXaf = (n: number, lang: Lang) =>
  `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US').format(n)} FCFA`;

/** Répartit `total` votes sur `n` candidats (au moins 1 chacun, reste donné aux premiers). */
export function distribute(total: number, n: number): number[] {
  if (n <= 0 || total < n) return [];
  const base = Math.floor(total / n); const rest = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Numéro camerounais local (6XXXXXXXX / 2XXXXXXXX), avec ou sans +237, ou autre numéro international. */
export function validPhone(input: string): boolean {
  const p = input.replace(/[\s().-]/g, '');
  return /^(\+?237)?[62]\d{8}$/.test(p) || /^\+[1-9]\d{7,14}$/.test(p);
}

export function sanitizeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

export const mediaUrl = (key: string | null) =>
  key && process.env.NEXT_PUBLIC_MEDIA_URL ? `${process.env.NEXT_PUBLIC_MEDIA_URL.replace(/\/$/, '')}/${key}` : null;

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
