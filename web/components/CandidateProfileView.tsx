'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { formatXaf, initials, mediaUrl, sanitizeColor } from '../lib/format';
import type { Candidate, ContestPage } from '../lib/types';
import ShareBar from './ShareBar';
import VoteSheet from './VoteSheet';
import { useLang } from './useLang';

export default function CandidateProfileView({ contest, candidates, packs, base, candidateNumber }:
  ContestPage & { base: string; candidateNumber: number }) {
  const { lang, setLang, t, err } = useLang(contest.defaultLocale);
  const candidate = candidates.find((c) => c.number === candidateNumber) as Candidate;
  const [now, setNow] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setNow(Date.now()); setOrigin(window.location.origin); }, []);

  const color = sanitizeColor(contest.theme?.primaryColor, '#D71920');
  const image = mediaUrl(candidate.imageKey);
  const logoKey = typeof contest.theme?.logoKey === 'string' ? contest.theme.logoKey : null;
  const logoUrl = logoKey ? mediaUrl(logoKey) : null;
  const starts = contest.startsAt ? new Date(contest.startsAt).getTime() : null;
  const ends = contest.endsAt ? new Date(contest.endsAt).getTime() : null;
  const notStarted = now !== null && starts !== null && now < starts;
  const over = contest.status === 'closed' || (now !== null && ends !== null && now > ends);
  const canVote = contest.status === 'active' && !notStarted && !over;
  const status = over ? (lang === 'fr' ? 'Concours terminé' : 'Contest ended')
    : contest.status === 'paused' ? (lang === 'fr' ? 'Votes suspendus' : 'Voting paused')
    : notStarted ? (lang === 'fr' ? 'Ouverture prochaine' : 'Coming soon')
    : canVote ? (lang === 'fr' ? 'Votes ouverts' : 'Voting open')
    : (lang === 'fr' ? 'Indisponible' : 'Unavailable');
  const shareUrl = origin ? `${origin}${base}/c/${candidate.number}` : '';
  const shareText = lang === 'fr'
    ? `Découvrez ${candidate.name}, candidat(e) au concours ${contest.name}.`
    : `Meet ${candidate.name}, a candidate in ${contest.name}.`;
  const style = { '--primary': color, '--contest-accent': color } as CSSProperties;
  const selected = useMemo(() => [candidate], [candidate]);

  return (
    <div className="page public-contest candidate-profile-page" style={style}>
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
            <a className="public-share-link" href="#profil-partager">{t('share')}</a>
          </div>
        </div>
      </header>

      <main className="candidate-profile-main">
        <a className="candidate-profile-back" href={base}>← {lang === 'fr' ? 'Retour au concours' : 'Back to contest'}</a>
        <section className="candidate-profile-card">
          <div className="candidate-profile-photo">
            {image ? <img src={image} alt={candidate.name} width={900} height={1100} /> :
              <div className="candidate-profile-placeholder">{initials(candidate.name)}</div>}
            <span className="candidate-profile-number">N° {String(candidate.number).padStart(2, '0')}</span>
          </div>
          <div className="candidate-profile-info">
            <span className="public-section-kicker">{contest.name}</span>
            <span className="candidate-profile-status"><i className={canVote ? 'is-live' : ''} />{status}</span>
            <h1>{candidate.name}</h1>
            {candidate.description
              ? <p className="candidate-profile-description">{candidate.description}</p>
              : <p className="candidate-profile-description muted">{lang === 'fr' ? 'Aucune présentation n’a encore été publiée pour ce candidat.' : 'No candidate biography has been published yet.'}</p>}
            <div className="candidate-profile-facts">
              <div><span>{lang === 'fr' ? 'Numéro de candidature' : 'Candidate number'}</span><strong>#{candidate.number}</strong></div>
              <div><span>{lang === 'fr' ? 'Participants' : 'Candidates'}</span><strong>{candidates.length}</strong></div>
              {contest.voteType !== 'free' && <div><span>{lang === 'fr' ? 'Prix par vote' : 'Price per vote'}</span><strong>{formatXaf(contest.votePriceXaf, lang)}</strong></div>}
            </div>
            {contest.description && <div className="candidate-profile-contest"><span>{lang === 'fr' ? 'À propos du concours' : 'About the contest'}</span><p>{contest.description}</p></div>}
            {canVote && <button type="button" className="btn btn-primary candidate-profile-vote" onClick={() => setSheet(true)}>
              {lang === 'fr' ? 'Voter pour ce candidat' : 'Vote for this candidate'} <span>↗</span>
            </button>}
            {!canVote && <p className="candidate-profile-unavailable">{lang === 'fr' ? 'Le vote n’est pas disponible actuellement.' : 'Voting is not currently available.'}</p>}
            <div id="profil-partager" className="candidate-profile-share">
              {shareUrl && <ShareBar url={shareUrl} text={shareText} t={t} />}
            </div>
          </div>
        </section>
        <div className="candidate-profile-bottom">
          <a href={base}>← {lang === 'fr' ? 'Voir tous les candidats' : 'View all candidates'}</a>
          <span>{lang === 'fr' ? 'Propulsé par VOTALLY' : 'Powered by VOTALLY'}</span>
        </div>
      </main>

      {sheet && <VoteSheet contest={contest} packs={packs} selected={selected} lang={lang} tt={{ t, err }}
        shareUrl={shareUrl || ''} onClose={() => setSheet(false)} />}
    </div>
  );
}
