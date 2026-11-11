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

  const color = sanitizeColor(contest.theme?.primaryColor, '#D71920');
  const banner = mediaUrl(contest.bannerKey);
  const logoKey = typeof contest.theme?.logoKey === 'string' ? contest.theme.logoKey : null;
  const logoUrl = logoKey ? mediaUrl(logoKey) : null;
  const site = (contest.siteContent ?? {}) as Record<string, string | null | undefined>;
  const hasEditorial = Boolean(site.tagline || site.concept || site.objectives || site.eligibility || site.location || site.contactEmail || site.contactPhone || site.websiteUrl || site.instagramUrl || site.facebookUrl);
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
  const pageStyle = { '--primary': color, '--contest-accent': color } as CSSProperties;

  return (
    <div className="page public-contest" style={pageStyle}>
      <header className="public-top">
        <div className="public-top-inner">
          <a className="public-identity" href={base || '/'} aria-label={contest.name}>
            {logoUrl ? <img className="public-identity-logo" src={logoUrl} alt="" /> : <span className="public-identity-mark">{(contest.organizerName || contest.name).trim().charAt(0).toUpperCase()}</span>}
            <span className="public-identity-name">{contest.organizerName || contest.name}</span>
          </a>
          <div className="public-top-actions">
            <div className="lang" role="group" aria-label="Language">
              <button type="button" className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            </div>
            <a className="public-share-link" href="#partager">{t('share')}</a>
          </div>
        </div>
      </header>

      <section className={`public-cover${banner ? ' has-banner' : ''}`} style={banner ? { backgroundImage: `linear-gradient(90deg, #101014e8 0%, #101014a8 55%, #10101440 100%), url("${banner}")` } : undefined}>
        <div className="public-cover-inner">
          <div className="public-cover-copy">
            <span className="public-overline">{contest.organizerName || 'CONCOURS'}</span>
            <h1>{contest.name}</h1>
            {site.tagline && <p className="public-tagline">{site.tagline}</p>}
            {contest.description && <p>{contest.description}</p>}
            <div className="public-cover-meta">
              {statusLine && <span className={`public-status${canVote ? ' live' : ''}`}><i />{statusLine}</span>}
              {contest.voteType !== 'free' && <span>{t('pricePerVote', { price: formatXaf(contest.votePriceXaf, lang) })}</span>}
              <span>{candidates.length} {t('candidates').toLowerCase()}</span>
            </div>
            {canVote && <a className="public-cover-cta" href="#participants" onClick={() => setTab('candidates')}>{t('candidates')} <span>↓</span></a>}
          </div>
          <div className="public-cover-side" aria-hidden="true"><span className="public-cover-number">01</span><span className="public-cover-line" /></div>
        </div>
      </section>

      {hasEditorial && (
        <section className="public-editorial" aria-label="Présentation du concours">
          <div className="public-editorial-grid">
            {(site.concept || contest.description) && <article className="public-editorial-card public-editorial-concept">
              <span className="public-section-kicker">LE CONCEPT</span>
              <h2>À propos du concours</h2>
              <p>{site.concept || contest.description}</p>
            </article>}
            {site.objectives && <article className="public-editorial-card">
              <span className="public-section-kicker">NOTRE AMBITION</span>
              <h2>Les objectifs</h2><p>{site.objectives}</p>
            </article>}
            {(site.eligibility || site.location) && <article className="public-editorial-card">
              <span className="public-section-kicker">PARTICIPATION</span><h2>Informations pratiques</h2>
              {site.location && <p><strong>Lieu :</strong> {site.location}</p>}
              {site.eligibility && <p><strong>Éligibilité :</strong> {site.eligibility}</p>}
            </article>}
            {(site.contactEmail || site.contactPhone || site.websiteUrl || site.instagramUrl || site.facebookUrl) && <article className="public-editorial-card">
              <span className="public-section-kicker">RESTONS EN CONTACT</span><h2>Contacter l’organisation</h2>
              {site.contactEmail && <p><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></p>}
              {site.contactPhone && <p><a href={`tel:${site.contactPhone}`}>{site.contactPhone}</a></p>}
              {site.websiteUrl && <p><a href={site.websiteUrl} target="_blank" rel="noreferrer">Site officiel ↗</a></p>}
              {site.instagramUrl && <p><a href={site.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a></p>}
              {site.facebookUrl && <p><a href={site.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a></p>}
            </article>}
          </div>
        </section>
      )}

      <main className="public-main">
        <div className="public-main-head">
          <div><span className="public-section-kicker">LE CONCOURS</span><h2>{focus ? focus.name : contest.name}</h2>
            <p>{focus ? (focus.description || contest.description || '') : (contest.organizerName ? `Organisé par ${contest.organizerName}` : 'Découvrez les participants et prenez part au vote.')}</p>
          </div>
          <div id="partager" className="public-share-area">{pageUrl && <ShareBar url={pageUrl} text={shareText} t={t} />}</div>
        </div>

        {contest.rules && <details className="rules public-rules"><summary>{t('rules')}</summary><p>{contest.rules}</p></details>}

        <div className="public-content-bar">
          <div className="public-tabs" role="tablist" aria-label="Contenu du concours">
            <button role="tab" aria-selected={tab === 'candidates'} className={tab === 'candidates' ? 'on' : ''} onClick={() => setTab('candidates')} type="button"><span>01</span>{t('candidates')}</button>
            <button role="tab" aria-selected={tab === 'results'} className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')} type="button"><span>02</span>{t('results')}</button>
          </div>
          {tab === 'candidates' && <span className="public-count">{candidates.length} {t('candidates').toLowerCase()}</span>}
        </div>

        {tab === 'candidates' ? (
          <>
            {canVote && contest.maxChoicesPerVote > 1 && <p className="muted small public-select-hint">{t('selectHint', { n: contest.maxChoicesPerVote })}</p>}
            <div className="grid public-candidate-grid" id="participants">
              {candidates.map((c) => (
                <CandidateCard key={c.id} c={c} t={t} canVote={canVote} selected={selected.includes(c.id)}
                  highlight={c.number === focusNumber} onToggle={() => toggle(c.id)} href={`${base}/c/${c.number}`} />
              ))}
            </div>
          </>
        ) : (
          <section className="public-results-panel"><div><span className="public-section-kicker">CLASSEMENT</span><h3>{t('results')}</h3></div>
            <Results slug={contest.slug} realtime={contest.resultsDisplay === 'realtime' && !over} t={t} err={err} />
          </section>
        )}
      </main>

      <footer className="public-footer">
        <div className="public-footer-inner"><div className="public-footer-brand"><span className="public-identity-mark">V</span><span>{contest.name}</span></div>
          <span>{contest.organizerName ? `Organisé par ${contest.organizerName}` : 'Concours en ligne'}</span>
          <span>Propulsé par VOTALLY</span>
        </div>
      </footer>

      {canVote && chosen.length > 0 && !sheet && (
        <div className="bar-fixed public-vote-bar"><div className="public-vote-summary"><strong>{chosen.length}</strong><span>{chosen.length > 1 ? 'participants sélectionnés' : 'participant sélectionné'}</span></div>
          <button className="btn btn-primary block" type="button" onClick={() => setSheet(true)}>{t('voteFor', { n: chosen.length })} <span aria-hidden>↗</span></button>
        </div>
      )}
      {sheet && (
        <VoteSheet contest={contest} packs={packs} selected={chosen} lang={lang} tt={{ t, err }}
          shareUrl={pageUrl || ''} onClose={() => setSheet(false)} />
      )}
    </div>
  );
}
