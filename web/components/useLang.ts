'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { makeT } from '../lib/i18n';
import type { Lang } from '../lib/types';

/** Langue : choix mémorisé > langue du concours. Valeur initiale = langue du concours (évite l'écart d'hydratation). */
export function useLang(defaultLang: Lang) {
  const [lang, setLangState] = useState<Lang>(defaultLang);
  useEffect(() => {
    try { const s = localStorage.getItem('votally_lang'); if (s === 'fr' || s === 'en') setLangState(s); } catch { /* stockage indisponible */ }
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('votally_lang', l); } catch { /* ignoré */ }
    document.documentElement.lang = l;
  }, []);
  const tt = useMemo(() => makeT(lang), [lang]);
  return { lang, setLang, ...tt };
}
