'use client';
import { useState } from 'react';
import type { T } from '../lib/i18n';

export default function ShareBar({ url, text, t }: { url: string; text: string; t: T['t'] }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt(t('copyLink'), url); }
  };
  const nativeShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="share" role="group" aria-label={t('share')}>
      <a className="btn btn-wa" href={`https://wa.me/?text=${enc(text + ' ' + url)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className="btn btn-ghost" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`} target="_blank" rel="noopener noreferrer">Facebook</a>
      <a className="btn btn-ghost" href={`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer">X</a>
      <button className="btn btn-ghost" onClick={copy} type="button">{copied ? t('copied') : t('copyLink')}</button>
      {nativeShare && <button className="btn btn-ghost" type="button" onClick={() => navigator.share({ title: text, url }).catch(() => undefined)}>{t('share')}</button>}
    </div>
  );
}
