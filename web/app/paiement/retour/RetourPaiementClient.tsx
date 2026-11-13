
'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/client';

type Order = {
  reference: string;
  status: string;
  contestName: string;
  slug: string;
  confirmedAt: string | null;
};

export default function RetourPaiementClient() {
  const params = useSearchParams();
  const reference = params.get('order');

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!reference) return;

    let active = true;
    let timer: ReturnType<typeof setInterval>;

    const checkPayment = async () => {
      if (busy.current) return;
      busy.current = true;

      try {
        const result = await api<{ order: Order }>(
          `/public/orders/${encodeURIComponent(reference)}`
        );

        if (active) {
          setOrder(result.order);
          setError(false);

          if (['confirmed', 'failed', 'cancelled', 'refunded'].includes(result.order.status)) {
            clearInterval(timer);
          }
        }
      } catch {
        if (active) {
          setError(true);
          clearInterval(timer);
        }
      } finally {
        busy.current = false;
      }
    };

    checkPayment();
    timer = setInterval(checkPayment, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reference, refresh]);

  const verifyWithProvider = async () => {
    if (!reference || checking) return;

    setChecking(true);
    setError(false);

    try {
      const result = await api<{ order: Order }>(
        `/public/orders/${encodeURIComponent(reference)}/verify`,
        { method: 'POST' }
      );

      setOrder(result.order);
    } catch (e) {
      console.error('[VOTALLY] Vérification du paiement échouée :', e);
      setError(true);
    } finally {
      setChecking(false);
    }
  };

  const confirmed = order?.status === 'confirmed';
  const failed = ['failed', 'cancelled', 'refunded'].includes(order?.status ?? '');

  const title = confirmed
    ? 'Paiement confirmé'
    : failed
      ? 'Paiement non abouti'
      : 'Vérification du paiement';

  const message = confirmed
    ? 'Ton paiement a été confirmé. Tes votes ont été enregistrés.'
    : failed
      ? 'Le paiement n’a pas abouti. Aucun vote n’a été confirmé.'
      : 'Nous vérifions ton paiement auprès de notre serveur. Cette opération peut prendre quelques instants.';

  return (
    <main style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 20,
      background: '#f7f7f8',
      fontFamily: 'Arial, sans-serif'
    }}>
      <section style={{
        background: '#fff',
        width: '100%',
        maxWidth: 460,
        padding: 32,
        borderRadius: 18,
        textAlign: 'center',
        boxShadow: '0 8px 35px rgba(0,0,0,0.07)'
      }}>
        <div style={{ fontSize: 38, marginBottom: 16 }}>
          {confirmed ? '✓' : failed ? '!' : '↻'}
        </div>

        <p style={{ fontWeight: 700, letterSpacing: 2, fontSize: 12 }}>
          VOTALLY
        </p>

        <h1 style={{ fontSize: 24, marginBottom: 12 }}>{title}</h1>

        <p style={{ color: '#666', lineHeight: 1.6 }}>{message}</p>

        {order && (
          <div style={{
            background: '#f7f7f8',
            padding: 14,
            borderRadius: 10,
            marginTop: 22,
            fontSize: 13
          }}>
            <p><strong>Concours :</strong> {order.contestName}</p>
            <p><strong>Référence :</strong> {order.reference}</p>
            <p><strong>Statut :</strong> {order.status}</p>
          </div>
        )}

        {!order && !error && (
          <p style={{ color: '#888', marginTop: 20 }}>Connexion au serveur...</p>
        )}

        {error && (
          <p style={{ color: '#b45309', marginTop: 16 }}>
            La vérification rencontre un problème. Réessaie.
          </p>
        )}

        {!confirmed && !failed && (
          <button
            onClick={verifyWithProvider}
            disabled={checking || !reference}
            style={{
              marginTop: 22,
              padding: '12px 20px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: checking ? '#eee' : '#fff',
              cursor: checking ? 'not-allowed' : 'pointer',
              opacity: checking ? 0.7 : 1
            }}
          >
            {checking ? 'Vérification en cours...' : 'Vérifier maintenant'}
          </button>
        )}

        {order?.slug && (
          <p style={{ marginTop: 24 }}>
            <a href={`/${encodeURIComponent(order.slug)}`} style={{
              color: '#222',
              fontWeight: 600,
              textDecoration: 'none'
            }}>
              Retourner au concours
            </a>
          </p>
        )}

        {!reference && (
          <p style={{ color: '#b91c1c' }}>
            Référence de commande absente. Impossible de vérifier le paiement.
          </p>
        )}
      </section>
    </main>
  );
}
