'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="empty"><h1>Oups · Oops</h1>
      <p className="muted">Une erreur est survenue. Réessaie dans un instant. · Something went wrong. Please try again shortly.</p>
      <button className="btn btn-primary" type="button" onClick={reset}>Réessayer · Retry</button></main>
  );
}
