'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { formatXaf, mediaUrl, sanitizeColor } from '../lib/format';
import type { ContestPage } from '../lib/types';
import CandidateCard from './CandidateCard';
import Results from './Results';
import ShareBar from './ShareBar';
import VoteSheet from './VoteSheet';
import { useLang } from './useLang';

export default function ContestView({ contest, candidates, packs, base, focusNumber }: ContestPage & { base: string; focusNumber?: number }) {
  const { lang, setLang, t, err } = useLang(contest.defaultLocale);
  const [tab, setTab] = useState<'candidates' | 'results'>('candidates');
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const focus = candidates.find((c) => c.number === focusNumber);
  const [selected, setSelected] = useState<string[]>(focus ? [focus.id] : []);

  useEffect(() => {
    setNow(Date.now()); setOrigin(window.location.origin);
    if (focus) document.getElementById(`c${focus.number}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  const color = sanitizeColor(contest.theme?.primaryColor, '#0E7C66');
  const banner = mediaUrl(contest.bannerKey);
  const starts = contest.startsAt ? new Date(contest.startsAt).getTime() : null;
  const ends = contest.endsAt ? new Date(contest.endsAt).getTime() : null;
  const notStarted = now !== null && starts !== null && now < starts;
  const over = contest.status === 'closed' || (now !== null && ends !== null && now > ends);
  const canVote = contest.status === 'active' && !notStarted && !over;
  const fmtDate = (ms: number) => new Date(ms).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' });

  const statusLine = over ? t('statusEnded') : contest.status === 'paused' ? t('statusPaused')
    : notStarted && starts ? t('statusSoon', { date: fmtDate(starts) }) : ends ? t('statusEnds', { date: fmtDate(ends) }) : null;

  const toggle = (id: string) => setSelected((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    if (contest.maxChoicesPerVote === 1) return [id];
    return cur.length >= contest.maxChoicesPerVote ? cur : [...cur, id];
  });
  const chosen = useMemo(() => selected.map((id) => candidates.find((c) => c.id === id)!).filter(Boolean), [selected, candidates]);
  const pageUrl = origin ? `${origin}${base}` : '';
  const shareText = t('shareText', { name: focus?.name ?? contest.name, contest: contest.name });

  return (
    <div className="page" style={{ '--primary': color } as CSSProperties}>
      <header className="top">
        <div className="top-in">
          <span className="brand">VOTALLY</span>
          <div className="lang" role="group" aria-label="Language">
            <button type="button" className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
      </header>

      <section className="hero" style={banner ? { backgroundImage: `linear-gradient(#0008,#000a), url(${banner})` } : undefined}>
        <h1>{contest.name}</h1>
        {contest.organizerName && <p className="by">{t('organizedBy', { name: contest.organizerName })}</p>}
        {statusLine && <p className={`status${canVote ? ' live' : ''}`}>{statusLine}</p>}
        {contest.voteType !== 'free' && <p className="by">{t('pricePerVote', { price: formatXaf(contest.votePriceXaf, lang) })}</p>}
      </section>

      <main className="main">
        {contest.description && <p className="desc">{contest.description}</p>}
        {contest.rules && <details className="rules"><summary>{t('rules')}</summary><p>{contest.rules}</p></details>}
        {pageUrl && <ShareBar url={pageUrl} text={shareText} t={t} />}

        <div className="tabs big" role="tablist">
          <button role="tab" aria-selected={tab === 'candidates'} className={tab === 'candidates' ? 'on' : ''} onClick={() => setTab('candidates')} type="button">{t('candidates')}</button>
          <button role="tab" aria-selected={tab === 'results'} className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')} type="button">{t('results')}</button>
        </div>

        {tab === 'candidates' ? (
          <>
            {canVote && contest.maxChoicesPerVote > 1 && <p className="muted small">{t('selectHint', { n: contest.maxChoicesPerVote })}</p>}
            <div className="grid">
              {candidates.map((c) => (
                <CandidateCard key={c.id} c={c} t={t} canVote={canVote} selected={selected.includes(c.id)}
                  highlight={c.number === focusNumber} onToggle={() => toggle(c.id)} href={`${base}/c/${c.number}`} />
              ))}
            </div>
          </>
        ) : (
          <Results slug={contest.slug} realtime={contest.resultsDisplay === 'realtime' && !over} t={t} err={err} />
        )}
      </main>

      <footer className="foot">{t('poweredBy')}</footer>

      {canVote && chosen.length > 0 && !sheet && (
        <div className="bar-fixed"><button className="btn btn-primary block" type="button" onClick={() => setSheet(true)}>{t('voteFor', { n: chosen.length })}</button></div>
      )}
      {sheet && (
        <VoteSheet contest={contest} packs={packs} selected={chosen} lang={lang} tt={{ t, err }}
          shareUrl={pageUrl || ''} onClose={() => setSheet(false)} />
      )}
    </div>
  );
}
