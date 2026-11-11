import Link from 'next/link';

const features = [
  { number: '01', title: 'Lancez votre concours', text: 'Configurez les règles, les candidats et les modalités de vote depuis un espace unique.' },
  { number: '02', title: 'Mobilisez votre communauté', text: 'Partagez une page publique dédiée et donnez à chaque candidat sa propre visibilité.' },
  { number: '03', title: 'Suivez les résultats', text: 'Consultez les votes et les performances avec un suivi conçu pour rester lisible.' },
];

const methods = ['MTN Mobile Money', 'Orange Money', 'Mastercard · activation requise'];

export default function Home() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="VOTALLY, accueil">
          <span className="brand-mark">V</span>
          <span>VOTALLY</span>
        </Link>
        <nav className="landing-links" aria-label="Navigation principale">
          <a href="#fonctionnement">Fonctionnement</a>
          <a href="#paiements">Paiements</a>
        </nav>
        <div className="landing-actions">
          <Link href="/connexion" className="landing-login">Connexion</Link>
          <Link href="/inscription" className="landing-cta landing-cta-small">Créer un compte <span aria-hidden>↗</span></Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> LA PLATEFORME DE VOTE EN LIGNE</p>
          <h1>Vos concours.<br /><span>Votre communauté.</span><br />Un vote qui compte.</h1>
          <p className="hero-description">
            Créez, organisez et faites vivre vos concours sur une plateforme pensée pour les organisateurs et leur public.
          </p>
          <div className="hero-actions">
            <Link href="/inscription" className="landing-cta">Créer mon concours <span aria-hidden>↗</span></Link>
            <Link href="/connexion" className="landing-secondary">Accéder à mon espace <span aria-hidden>→</span></Link>
          </div>
          <div className="hero-proof">
            <span className="proof-icon">✓</span>
            <span>Une page dédiée pour chaque concours</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Aperçu d'un concours sur VOTALLY">
          <div className="visual-glow" />
          <div className="visual-card">
            <div className="visual-topline">
              <span className="visual-brand"><span className="brand-mark mini">V</span> VOTALLY</span>
              <span className="visual-live"><i /> EN COURS</span>
            </div>
            <div className="visual-cover">
              <span className="cover-kicker">ÉDITION 2026</span>
              <strong>THE NEXT<br />VOICE</strong>
              <span className="cover-caption">Le public choisit. Votre talent s'exprime.</span>
            </div>
            <div className="visual-content">
              <div className="visual-heading"><div><span className="visual-label">CONCOURS POPULAIRE</span><strong>Les candidats en compétition</strong></div><span className="visual-count">12 candidats</span></div>
              <div className="candidate-row"><span className="candidate-avatar avatar-one">A</span><span className="candidate-info"><strong>Amélie N.</strong><small>Candidate n° 04</small></span><span className="candidate-votes">1 284 <small>votes</small></span></div>
              <div className="candidate-row"><span className="candidate-avatar avatar-two">J</span><span className="candidate-info"><strong>Jordan M.</strong><small>Candidate n° 08</small></span><span className="candidate-votes">1 096 <small>votes</small></span></div>
              <div className="candidate-row"><span className="candidate-avatar avatar-three">S</span><span className="candidate-info"><strong>Sonia K.</strong><small>Candidate n° 11</small></span><span className="candidate-votes">972 <small>votes</small></span></div>
              <div className="visual-footer"><span>Résultats actualisés selon les règles du concours</span><span className="visual-arrow">↗</span></div>
            </div>
          </div>
          <div className="floating-note"><span className="note-check">✓</span><span><strong>Votre concours est prêt</strong><small>Une page, un lien, une communauté.</small></span></div>
          <div className="visual-index">01 <span /> 03</div>
        </div>
      </section>

      <section className="landing-strip" id="paiements">
        <div><span className="strip-label">UNE EXPÉRIENCE DE VOTE ACCESSIBLE</span><strong>Mobile Money et carte bancaire selon activation du prestataire</strong></div>
        <div className="payment-list">{methods.map((method) => <span key={method} className="payment-pill"><i />{method}</span>)}</div>
      </section>

      <section className="landing-how" id="fonctionnement">
        <div className="section-intro"><p className="eyebrow">SIMPLE À PRENDRE EN MAIN</p><h2>Du lancement au résultat,<br /><span>gardez le contrôle.</span></h2><p>Les outils essentiels pour gérer votre concours et offrir une expérience claire aux participants.</p></div>
        <div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><span className="feature-number">{feature.number}</span><div><h3>{feature.title}</h3><p>{feature.text}</p></div><span className="feature-arrow">↗</span></article>)}</div>
      </section>

      <section className="landing-bottom">
        <div><p className="eyebrow">PRÊT À VOUS LANCER ?</p><h2>Le prochain concours<br />commence ici.</h2></div>
        <Link href="/inscription" className="landing-cta landing-cta-light">Créer un compte gratuitement <span aria-hidden>↗</span></Link>
      </section>

      <footer className="landing-footer"><Link href="/" className="landing-brand"><span className="brand-mark">V</span><span>VOTALLY</span></Link><span>La plateforme qui donne la parole à votre communauté.</span><span>© {new Date().getFullYear()} VOTALLY</span></footer>
    </main>
  );
}
