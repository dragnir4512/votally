'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { formatXaf, mediaUrl, sanitizeColor } from '../lib/format';
import type { ContestPage } from '../lib/types';
import CandidateCard from './CandidateCard';
import Results from './Results';
import ShareBar from './ShareBar';
import VoteSheet from './VoteSheet';
import { useLang } from './useLang';

export type PublicSection = 'home' | 'candidates' | 'ranking' | 'rules' | 'about';

export default function ContestView({ contest, candidates, packs, base, focusNumber, section = 'home' }: ContestPage & { base: string; focusNumber?: number; section?: PublicSection }) {
  const { lang, setLang, t, err } = useLang(contest.defaultLocale);
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const route = (path: string) => `${base}${path}` || '/';
  const focus = candidates.find((c) => c.number === focusNumber);
  const [selected, setSelected] = useState<string[]>(focus ? [focus.id] : []);

  useEffect(() => {
    setNow(Date.now()); setOrigin(window.location.origin);
    if (focus) document.getElementById(`c${focus.number}`)?.scrollIntoView({ block: 'center' });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [focus]);

  const color = sanitizeColor(contest.theme?.primaryColor, '#D71920');
  const template = contest.theme?.template === 'spotlight' || contest.theme?.template === 'minimal' ? contest.theme.template : 'editorial';
  const banner = mediaUrl(contest.bannerKey);
  const logoKey = typeof contest.theme?.logoKey === 'string' ? contest.theme.logoKey : null;
  const logoUrl = logoKey ? mediaUrl(logoKey) : null;
  const site = (contest.siteContent ?? {}) as Record<string, string | null | undefined>;
  const hasEditorial = Boolean(contest.description || site.tagline || site.concept || site.objectives || site.eligibility || site.location || site.contactEmail || site.contactPhone || site.websiteUrl || site.instagramUrl || site.facebookUrl);
  const starts = contest.startsAt ? new Date(contest.startsAt).getTime() : null;
  const ends = contest.endsAt ? new Date(contest.endsAt).getTime() : null;
  const notStarted = now !== null && starts !== null && now < starts;
  const over = contest.status === 'closed' || (now !== null && ends !== null && now >= ends);
  const canVote = contest.status === 'active' && !notStarted && !over;
  const fmtDate = (ms: number) => new Date(ms).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' });
  const statusLine = over ? t('statusEnded') : contest.status === 'paused' ? t('statusPaused')
    : notStarted && starts ? t('statusSoon', { date: fmtDate(starts) }) : ends ? t('statusEnds', { date: fmtDate(ends) }) : null;
  const remainingSeconds = starts && now !== null ? Math.max(0, Math.floor((starts - now) / 1000)) : 0;
  const countdownParts = [
    { value: Math.floor(remainingSeconds / 86400), label: 'JOURS' },
    { value: Math.floor((remainingSeconds % 86400) / 3600), label: 'HEURES' },
    { value: Math.floor((remainingSeconds % 3600) / 60), label: 'MINUTES' },
    { value: remainingSeconds % 60, label: 'SECONDES' },
  ];
  const toggle = (id: string) => setSelected((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    if (contest.maxChoicesPerVote === 1) return [id];
    return cur.length >= contest.maxChoicesPerVote ? cur : [...cur, id];
  });
  const chosen = useMemo(() => selected.map((id) => candidates.find((c) => c.id === id)!).filter(Boolean), [selected, candidates]);
  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(lang === 'fr' ? 'fr' : 'en');
    return q ? candidates.filter((c) => c.name.toLocaleLowerCase(lang === 'fr' ? 'fr' : 'en').includes(q) || String(c.number).includes(q)) : candidates;
  }, [candidates, search, lang]);
  const pageUrl = origin ? `${origin}${base}` : '';
  const shareText = t('shareText', { name: focus?.name ?? contest.name, contest: contest.name });
  const pageStyle = { '--primary': color, '--contest-accent': color } as CSSProperties;
  const votePrice = contest.voteType === 'free' ? 'Vote gratuit' : formatXaf(contest.votePriceXaf, lang) + ' / vote';

  return (
    <div className={`page public-contest public-experience public-template-${template}`} style={pageStyle}>
      <header className="experience-nav">
        <div className="experience-nav-inner">
          <a className="experience-brand" href={base || '/'} aria-label={contest.name}>
            {logoUrl ? <img src={logoUrl} alt="" /> : <span className="experience-brand-mark">{(contest.organizerName || contest.name).trim().charAt(0).toUpperCase()}</span>}
            <span>{contest.organizerName || contest.name}</span>
          </a>
          <button className="experience-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="experience-site-menu" onClick={() => setMenuOpen((v) => !v)}>
            <span>{menuOpen ? 'Fermer' : 'Menu'}</span><i aria-hidden="true">{menuOpen ? '×' : '☰'}</i>
          </button>
          <nav id="experience-site-menu" className={`experience-links ${menuOpen ? 'is-open' : ''}`} aria-label="Navigation du concours">
            <a aria-current={section === 'home' ? 'page' : undefined} href={route('')}>Accueil</a>
            <a aria-current={section === 'candidates' ? 'page' : undefined} href={route('/candidats')}>Candidats</a>
            <a aria-current={section === 'ranking' ? 'page' : undefined} href={route('/classement')}>Classement</a>
            <a aria-current={section === 'rules' ? 'page' : undefined} href={route('/reglement')}>Règlement</a>
            <a aria-current={section === 'about' ? 'page' : undefined} href={route('/a-propos')}>À propos</a>
          </nav>
          <div className="experience-nav-actions">
            <div className="lang" role="group" aria-label="Language">
              <button type="button" className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            </div>
            <a className="experience-nav-share" href={route('/#partager')}>{t('share')}</a>
          </div>
        </div>
      </header>

      <main>
        {section === 'home' && <section className={`experience-hero${banner ? ' has-image' : ''}`} style={banner ? { backgroundImage: `linear-gradient(100deg, rgba(8,13,22,.94) 0%, rgba(8,13,22,.76) 48%, rgba(8,13,22,.18) 100%), url("${banner}")` } : undefined}>
          <div className="experience-hero-orb experience-orb-one" aria-hidden="true" />
          <div className="experience-hero-orb experience-orb-two" aria-hidden="true" />
          <div className="experience-hero-inner">
            <div className="experience-hero-copy">
              <div className="experience-eyebrow"><span className={`experience-live-dot ${canVote ? 'is-live' : ''}`} />{statusLine || 'COMPÉTITION EN LIGNE'}</div>
              <h1>{contest.name}</h1>
              {site.tagline && <p className="experience-tagline">{site.tagline}</p>}
              {contest.description && <p className="experience-description">{contest.description}</p>}
              <div className="experience-hero-actions">
                <a className="experience-primary-action" href={route('/candidats')}>{canVote ? 'Découvrir les candidats' : 'Voir les candidats'} <span>↗</span></a>
                <a className="experience-secondary-action" href={route('/classement')}>Voir le classement</a>
              </div>
            </div>
            <aside className="experience-hero-panel">
              <div className="experience-panel-top"><span>EN QUELQUES CHIFFRES</span><span className="experience-panel-icon">✳</span></div>
              <div className="experience-stat-main"><strong>{String(candidates.length).padStart(2, '0')}</strong><span>candidats<br />en compétition</span></div>
              <div className="experience-stat-divider" />
              <div className="experience-stat-grid">
                <div><strong>{votePrice}</strong><span>Tarif du vote</span></div>
                <div><strong>{over ? 'Terminé' : notStarted ? 'À venir' : contest.status === 'paused' ? 'En pause' : 'En direct'}</strong><span>État du concours</span></div>
              </div>
              {notStarted && starts && contest.status === 'active' && (
                <div className="experience-countdown" aria-live="polite">
                  <span>OUVERTURE DES VOTES DANS</span>
                  <div>{countdownParts.map((part) => <div key={part.label}><strong>{String(part.value).padStart(2, '0')}</strong><small>{part.label.slice(0, 3)}</small></div>)}</div>
                </div>
              )}
              {ends && !over && <p className="experience-deadline">Clôture : {fmtDate(ends)}</p>}
            </aside>
          </div>
          <div className="experience-hero-bottom"><span>VOTALLY / PUBLIC CONTEST</span><span>SCROLL POUR EXPLORER ↓</span></div>
        </section>}

        {section === 'home' && <section className="experience-proof-strip" aria-label="Informations du concours">
          <div><span>01</span><strong>Une compétition</strong><small>Des talents à découvrir</small></div>
          <div><span>02</span><strong>Un public engagé</strong><small>Votre voix compte</small></div>
          <div><span>03</span><strong>Un classement</strong><small>Mis à jour selon les votes validés</small></div>
        </section>}

        {(section === 'home' || section === 'about') && hasEditorial && <section className="experience-about" id="informations">
          <div className="experience-section-intro"><span className="experience-kicker">L'UNIVERS DU CONCOURS</span><h2>Une scène, des talents,<br /><em>une histoire à écrire.</em></h2></div>
          <div className="experience-about-grid">
            {(site.concept || contest.description) && <article className="experience-about-card experience-about-feature"><span>01 / LE CONCEPT</span><h3>À propos du concours</h3><p>{site.concept || contest.description}</p></article>}
            {site.objectives && <article className="experience-about-card"><span>02 / NOTRE AMBITION</span><h3>Notre ambition</h3><p>{site.objectives}</p></article>}
            {(site.eligibility || site.location) && <article className="experience-about-card"><span>03 / PARTICIPATION</span><h3>Informations pratiques</h3>{site.location && <p><b>Lieu</b> · {site.location}</p>}{site.eligibility && <p><b>Éligibilité</b> · {site.eligibility}</p>}</article>}
            {(site.contactEmail || site.contactPhone || site.websiteUrl || site.instagramUrl || site.facebookUrl) && <article className="experience-about-card"><span>04 / CONTACT</span><h3>Restons en contact</h3>{site.contactEmail && <p><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></p>}{site.contactPhone && <p><a href={`tel:${site.contactPhone}`}>{site.contactPhone}</a></p>}{site.websiteUrl && <p><a href={site.websiteUrl} target="_blank" rel="noreferrer">Site officiel ↗</a></p>}{site.instagramUrl && <p><a href={site.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a></p>}{site.facebookUrl && <p><a href={site.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a></p>}</article>}
          </div>
        </section>}

        {(section === 'candidates' || section === 'ranking' || section === 'rules') && <section className="experience-contest-area" id="participants">
          <div className="experience-section-heading">
            <div><span className="experience-kicker">{section === 'ranking' ? 'LES RÉSULTATS DU CONCOURS' : section === 'rules' ? 'INFORMATIONS OFFICIELLES' : 'LES VISAGES DU CONCOURS'}</span><h2>{section === 'ranking' ? <>Le <em>classement.</em></> : section === 'rules' ? <>Le <em>règlement.</em></> : <>Découvrez les <em>candidats.</em></>}</h2><p>{section === 'ranking' ? 'Consultez les positions calculées à partir des votes validés.' : section === 'rules' ? 'Les conditions et règles applicables à cette compétition.' : 'Explorez les profils, choisissez vos favoris et soutenez-les.'}</p></div>
            <div className="experience-section-index"><strong>{String(candidates.length).padStart(2, '0')}</strong><span>PARTICIPANTS</span></div>
          </div>
          {section === 'rules' && (contest.rules ? <details className="experience-rules" open><summary>Règlement officiel <span>−</span></summary><p>{contest.rules}</p></details> : <div className="experience-no-match"><strong>Règlement non publié</strong><p>L’organisateur n’a pas encore ajouté le règlement de ce concours.</p></div>)}
          {section !== 'rules' && <div className="experience-tools">
            {section === 'candidates' ? <label className="experience-search"><span aria-hidden>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un candidat ou un numéro…" aria-label="Rechercher un candidat" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche">×</button>}</label>
              : <span className="experience-results-note">Résultats selon les votes validés</span>}
          </div>}

          {section === 'candidates' ? <>
            {canVote && contest.maxChoicesPerVote > 1 && <p className="muted small experience-select-hint">{t('selectHint', { n: contest.maxChoicesPerVote })}</p>}
            {filteredCandidates.length ? <div className="grid experience-candidate-grid">
              {filteredCandidates.map((c) => <CandidateCard key={c.id} c={c} t={t} canVote={canVote} selected={selected.includes(c.id)} highlight={c.number === focusNumber} onToggle={() => toggle(c.id)} href={`${base}/c/${c.number}`} />)}
            </div> : <div className="experience-no-match"><strong>Aucun candidat trouvé</strong><p>Essayez un autre nom ou numéro.</p></div>}
          </> : section === 'ranking' ? <section className="experience-results"><div className="experience-results-heading"><div><span className="experience-kicker">LIVE LEADERBOARD</span><h3>Le classement</h3></div><span>Les positions évoluent avec les votes confirmés</span></div>
            <Results slug={contest.slug} realtime={contest.resultsDisplay === 'realtime' && !over} t={t} err={err} />
          </section> : null}
        </section>}

        {section === 'home' && <section className="experience-share-band" id="partager"><div><span className="experience-kicker">FAITES PASSER LE MOT</span><h2>Votre soutien peut<br /><em>tout changer.</em></h2><p>Partagez le concours et invitez votre communauté à découvrir les candidats.</p></div>
          {pageUrl && <ShareBar url={pageUrl} text={shareText} t={t} />}
        </section>}
      </main>

      <footer className="experience-footer"><div className="experience-footer-main"><a className="experience-brand" href={base || '/'}><span className="experience-brand-mark">V</span><span>VOTALLY</span></a><span>{contest.name}</span><span>{contest.organizerName ? `Organisé par ${contest.organizerName}` : 'Concours en ligne'}</span></div><div className="experience-footer-bottom"><span>© {new Date().getFullYear()} · Tous droits réservés</span><span>Une expérience propulsée par VOTALLY</span></div></footer>

      {canVote && chosen.length > 0 && !sheet && <div className="bar-fixed public-vote-bar experience-vote-bar"><div className="public-vote-summary"><strong>{chosen.length}</strong><span>{chosen.length > 1 ? 'participants sélectionnés' : 'participant sélectionné'}</span></div><button className="btn btn-primary block" type="button" onClick={() => setSheet(true)}>{t('voteFor', { n: chosen.length })} <span aria-hidden>↗</span></button></div>}
      {sheet && <VoteSheet contest={contest} packs={packs} selected={chosen} lang={lang} tt={{ t, err }} shareUrl={pageUrl || ''} onClose={() => setSheet(false)} />}
    </div>
  );
}
